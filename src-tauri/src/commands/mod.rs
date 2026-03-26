use crate::db::{DashboardStats, Dot, DotDetail};
use crate::twitter::bookmarks_fetcher::BookmarksFetcher;
use crate::workers;
use crate::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize, Clone)]
pub struct SyncResult {
    pub new_tweets: u32,
    pub total_tweets: u32,
}

// ── X Connection ──

#[derive(Debug, Serialize, Clone)]
pub struct XConnection {
    pub connected: bool,
    pub browser: Option<String>,
}

#[tauri::command]
pub async fn check_x_connection() -> Result<XConnection, String> {
    tokio::task::spawn_blocking(|| {
        let browser = BookmarksFetcher::detect_browser();
        Ok(XConnection {
            connected: browser.is_some(),
            browser,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── X Account ──

#[tauri::command]
pub async fn get_x_account() -> Result<crate::twitter::types::XAccount, String> {
    tokio::task::spawn_blocking(|| -> Result<crate::twitter::types::XAccount, String> {
        let fetcher = BookmarksFetcher::from_browser().map_err(|e| e.to_string())?;
        let _user_id = fetcher.viewer_user_id().map_err(|e| e.to_string())?;
        Ok(crate::twitter::types::XAccount {
            handle: "connected".to_string(),
            name: "Compte X".to_string(),
            avatar_url: None,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Sync ──

#[tauri::command]
pub async fn sync_bookmarks(state: State<'_, AppState>) -> Result<SyncResult, String> {
    let fetcher = BookmarksFetcher::from_browser().map_err(|e| e.to_string())?;
    let tweets = fetcher.fetch_all(50).map_err(|e| e.to_string())?;
    let new_tweets = state
        .db
        .upsert_tweets(&tweets, "bookmark")
        .map_err(|e| e.to_string())?;
    let total_tweets = state.db.tweet_count().map_err(|e| e.to_string())?;
    Ok(SyncResult {
        new_tweets,
        total_tweets,
    })
}

// ── Tweets ──

#[tauri::command]
pub async fn search_tweets(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
    source: Option<String>,
) -> Result<Vec<crate::db::TweetRow>, String> {
    state
        .db
        .search_fulltext(&query, limit.unwrap_or(20), source.as_deref())
        .map_err(|e| e.to_string())
}

// ── AI ──

#[tauri::command]
pub async fn reset_enrichments(state: State<'_, AppState>) -> Result<u32, String> {
    state.db.reset_all_enrichments().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_api_key(state: State<'_, AppState>) -> Result<bool, String> {
    let config = state.config.lock().map_err(|_| "config lock error".to_string())?;
    Ok(config.has_api_key())
}

#[tauri::command]
pub async fn delete_api_key(state: State<'_, AppState>) -> Result<bool, String> {
    let mut config = state.config.lock().map_err(|_| "config lock error".to_string())?;
    config.anthropic_api_key = None;
    config.save(&state.app_dir).map_err(|e| e.to_string())?;
    Ok(true)
}

#[derive(Debug, Serialize, Clone)]
pub struct ApiUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_cost_usd: f64,
}

#[tauri::command]
pub async fn get_api_usage(state: State<'_, AppState>) -> Result<ApiUsage, String> {
    let config = state.config.lock().map_err(|_| "config lock error".to_string())?;
    Ok(ApiUsage {
        input_tokens: config.api_usage_input_tokens,
        output_tokens: config.api_usage_output_tokens,
        estimated_cost_usd: config.estimated_cost_usd(),
    })
}

#[tauri::command]
pub async fn set_api_key(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    api_key: String,
) -> Result<bool, String> {
    // Verify the key with a lightweight API call first
    let key_clone = api_key.clone();
    let valid = tokio::task::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &key_clone)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .body(r#"{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}"#)
            .send()
            .map_err(|e| e.to_string())?;
        if resp.status() == 401 {
            return Err("Clé API invalide".to_string());
        }
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?;

    valid?;

    {
        let mut config = state.config.lock().map_err(|_| "config lock error".to_string())?;
        config.anthropic_api_key = Some(api_key.clone());
        config.save(&state.app_dir).map_err(|e| e.to_string())?;
    }
    workers::start_all(
        state.db.clone(),
        Some(api_key),
        app_handle,
        &state.workers,
        Some(state.config.clone()),
        Some(state.app_dir.clone()),
    );
    Ok(true)
}

// ── Dots ──

#[tauri::command]
pub async fn list_dots(state: State<'_, AppState>) -> Result<Vec<Dot>, String> {
    state.db.list_dots().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_dot_detail(
    state: State<'_, AppState>,
    slug: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Option<DotDetail>, String> {
    state
        .db
        .get_dot_detail(&slug, limit.unwrap_or(50), offset.unwrap_or(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_tweet_dot(
    state: State<'_, AppState>,
    tweet_id: String,
    from_dot_slug: String,
    to_dot_slug: String,
    reason: Option<String>,
) -> Result<bool, String> {
    state
        .db
        .move_tweet_to_dot(&tweet_id, &from_dot_slug, &to_dot_slug, reason.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn rename_dot(
    state: State<'_, AppState>,
    slug: String,
    new_name: String,
    new_slug: String,
    reason: Option<String>,
) -> Result<bool, String> {
    state
        .db
        .rename_dot_with_correction(&slug, &new_name, &new_slug, reason.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn delete_dot(state: State<'_, AppState>, slug: String) -> Result<u32, String> {
    state.db.delete_dot(&slug).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_dot(
    state: State<'_, AppState>,
    name: String,
    slug: String,
    color: Option<String>,
) -> Result<i64, String> {
    state
        .db
        .create_dot(&name, &slug, color.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_dot_slugs(
    state: State<'_, AppState>,
) -> Result<Vec<(String, String)>, String> {
    state.db.list_dot_slugs().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_dots(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<Dot>, String> {
    state
        .db
        .search_dots_by_content(&query, limit.unwrap_or(20))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backfill_dots(state: State<'_, AppState>) -> Result<u32, String> {
    state.db.backfill_dots().map_err(|e| e.to_string())
}

// ── Dashboard ──

#[tauri::command]
pub async fn get_dashboard_stats(state: State<'_, AppState>) -> Result<DashboardStats, String> {
    state.db.get_dashboard_stats().map_err(|e| e.to_string())
}

// ── Tweet webview ──

#[tauri::command]
pub async fn open_tweet_panel(
    app: tauri::AppHandle,
    url: String,
    _left_offset: f64,
    _height: f64,
    _width: f64,
) -> Result<bool, String> {
    use tauri::webview::WebviewBuilder;
    use tauri::Manager;

    let parsed_url: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;

    if let Some(existing) = app.get_webview("tweet-panel") {
        let escaped = serde_json::to_string(&parsed_url.to_string()).map_err(|e| e.to_string())?;
        existing
            .eval(&format!("window.location.href = {};", escaped))
            .map_err(|e| e.to_string())?;
        return Ok(true);
    }

    let builder = WebviewBuilder::new("tweet-panel", tauri::WebviewUrl::External(parsed_url))
        .on_navigation(|_url| true)
        .initialization_script(
            r#"
            document.addEventListener('click', function(e) {
                const link = e.target.closest('a[target="_blank"]');
                if (link) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = link.href;
                }
            }, true);
            window.open = function(url) { if (url) window.location.href = url; };
        "#,
        );

    let win = app.get_window("main").ok_or("No main window")?;
    let size = win.inner_size().map_err(|e| e.to_string())?;
    win.add_child(
        builder,
        tauri::Position::Physical(tauri::PhysicalPosition::new((size.width / 2) as i32, 0)),
        tauri::Size::Physical(tauri::PhysicalSize::new(size.width / 2, size.height)),
    )
    .map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub async fn close_tweet_panel(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;

    if let Some(wv) = app.get_webview("tweet-panel") {
        let _ = wv.close();
    }
    Ok(true)
}

#[tauri::command]
pub async fn webview_back(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;
    if let Some(wv) = app.get_webview("tweet-panel") {
        wv.eval("window.history.back()")
            .map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub async fn webview_forward(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;
    if let Some(wv) = app.get_webview("tweet-panel") {
        wv.eval("window.history.forward()")
            .map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub async fn open_in_browser(url: String) -> Result<bool, String> {
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http/https URLs are allowed".into()),
    }
    open::that(&url).map_err(|e| e.to_string())?;
    Ok(true)
}
