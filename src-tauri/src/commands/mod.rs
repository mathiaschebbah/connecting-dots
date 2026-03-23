use crate::agent::{self, AgentEvent, ChatMessage};
use crate::db::{DashboardStats, Dot, DotDetail, Tag, TweetFull, TweetNote, TweetRow};
use crate::twitter::clix::Clix;
use crate::workers;
use crate::AppState;
use serde::Serialize;
use tauri::{Emitter, State};

#[derive(Debug, Serialize, Clone)]
pub struct SyncResult {
    pub new_tweets: u32,
    pub total_tweets: u32,
}

// ── Sync ──

#[tauri::command]
pub async fn sync_bookmarks(state: State<'_, AppState>) -> Result<SyncResult, String> {
    let clix = Clix::new();
    let tweets = clix.bookmarks(200).map_err(|e| e.to_string())?;
    let new_tweets = state.db.upsert_tweets(&tweets, "bookmark").map_err(|e| e.to_string())?;
    let total_tweets = state.db.tweet_count().map_err(|e| e.to_string())?;
    Ok(SyncResult { new_tweets, total_tweets })
}

// ── Tweets ──

#[tauri::command]
pub async fn list_tweets(state: State<'_, AppState>, limit: Option<u32>, offset: Option<u32>, source: Option<String>) -> Result<Vec<TweetRow>, String> {
    state.db.list_tweets(limit.unwrap_or(50), offset.unwrap_or(0), source.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_tweets(state: State<'_, AppState>, query: String, limit: Option<u32>, source: Option<String>) -> Result<Vec<TweetRow>, String> {
    state.db.search_fulltext(&query, limit.unwrap_or(20), source.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_semantic(state: State<'_, AppState>, query: String, limit: Option<u32>) -> Result<Vec<TweetRow>, String> {
    let embedding = state.embedder.embed_one(&query).map_err(|e| e.to_string())?;
    state.db.search_semantic(&embedding, limit.unwrap_or(20)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tweet_count(state: State<'_, AppState>) -> Result<u32, String> {
    state.db.tweet_count().map_err(|e| e.to_string())
}

// ── Embeddings ──

#[derive(Debug, Serialize, Clone)]
pub struct EmbedResult { pub embedded_count: u32, pub remaining: u32 }

#[tauri::command]
pub async fn embed_pending(state: State<'_, AppState>) -> Result<EmbedResult, String> {
    let pending = state.db.tweets_without_embedding(50).map_err(|e| e.to_string())?;
    if pending.is_empty() { return Ok(EmbedResult { embedded_count: 0, remaining: 0 }); }
    let texts: Vec<String> = pending.iter().map(|(_, c)| c.clone()).collect();
    let embeddings = state.embedder.embed_batch(&texts).map_err(|e| e.to_string())?;
    let mut count = 0u32;
    for ((id, _), emb) in pending.iter().zip(embeddings.iter()) {
        state.db.store_embedding(id, emb).map_err(|e| e.to_string())?;
        count += 1;
    }
    let remaining = state.db.tweets_without_embedding(1).map_err(|e| e.to_string())?.len() as u32;
    Ok(EmbedResult { embedded_count: count, remaining })
}

// ── AI ──

#[tauri::command]
pub async fn reset_enrichments(state: State<'_, AppState>) -> Result<u32, String> {
    state.db.reset_all_enrichments().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_api_key(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.config.lock().unwrap().has_api_key())
}

#[tauri::command]
pub async fn set_api_key(state: State<'_, AppState>, app_handle: tauri::AppHandle, api_key: String) -> Result<bool, String> {
    { let mut config = state.config.lock().unwrap(); config.anthropic_api_key = Some(api_key.clone()); config.save(&state.app_dir).map_err(|e| e.to_string())?; }
    workers::start_all(state.db.clone(), state.embedder.clone(), Some(api_key), app_handle);
    Ok(true)
}

// ── Tweet Detail ──

#[derive(Debug, Serialize, Clone)]
pub struct TweetDetailResult { pub tweet: TweetFull, pub similar: Vec<TweetRow>, pub tags: Vec<Tag> }

#[tauri::command]
pub async fn get_tweet_detail(state: State<'_, AppState>, tweet_id: String) -> Result<TweetDetailResult, String> {
    let tweet = state.db.get_tweet_full(&tweet_id).map_err(|e| e.to_string())?.ok_or("Tweet not found")?;
    let similar = if tweet.has_embedding {
        match state.db.get_embedding(&tweet_id) {
            Ok(Some(emb)) => state.db.search_semantic(&emb, 10).unwrap_or_default().into_iter().filter(|t| t.id != tweet_id).collect(),
            _ => vec![],
        }
    } else { vec![] };
    let tags = state.db.get_tweet_tags(&tweet_id).unwrap_or_default();
    Ok(TweetDetailResult { tweet, similar, tags })
}

// ── Thread ──

#[derive(Debug, Serialize, Clone)]
pub struct ThreadData { pub tweets: Vec<ThreadTweet> }

#[derive(Debug, Serialize, Clone)]
pub struct ThreadTweet {
    pub id: String, pub author_handle: String, pub author_name: Option<String>,
    pub content: String, pub created_at: Option<String>, pub tweet_url: Option<String>,
    pub likes: i64, pub retweets: i64, pub replies_count: i64, pub views: i64,
}

#[tauri::command]
pub async fn get_thread(tweet_id: String) -> Result<ThreadData, String> {
    let clix = Clix::new();
    match clix.tweet_thread(&tweet_id) {
        Ok(tweets) => {
            let thread_tweets: Vec<ThreadTweet> = tweets.into_iter().map(|t| {
                let eng = t.engagement.as_ref();
                ThreadTweet {
                    id: t.id, author_handle: t.author_handle, author_name: t.author_name,
                    content: t.text, created_at: t.created_at, tweet_url: t.tweet_url,
                    likes: eng.and_then(|e| e.likes).unwrap_or(0),
                    retweets: eng.and_then(|e| e.retweets).unwrap_or(0),
                    replies_count: eng.and_then(|e| e.replies).unwrap_or(0),
                    views: eng.and_then(|e| e.views).unwrap_or(0),
                }
            }).collect();
            Ok(ThreadData { tweets: thread_tweets })
        }
        Err(e) => Err(e.to_string()),
    }
}

// ── Tags ──

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    state.db.list_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_and_assign_tag(state: State<'_, AppState>, tweet_id: String, tag_name: String, color: Option<String>) -> Result<Tag, String> {
    let tag_id = state.db.create_tag(&tag_name, color.as_deref()).map_err(|e| e.to_string())?;
    state.db.tag_tweet(&tweet_id, tag_id).map_err(|e| e.to_string())?;
    Ok(Tag { id: tag_id, name: tag_name, color })
}

#[tauri::command]
pub async fn remove_tag_from_tweet(state: State<'_, AppState>, tweet_id: String, tag_id: i64) -> Result<bool, String> {
    state.db.untag_tweet(&tweet_id, tag_id).map_err(|e| e.to_string())?;
    Ok(true)
}

// ── Agent ──

#[tauri::command]
pub async fn send_agent_message(state: State<'_, AppState>, app: tauri::AppHandle, message: String, history: Vec<ChatMessage>) -> Result<bool, String> {
    let api_key = { state.config.lock().unwrap().api_key().map(String::from).ok_or("No API key")? };
    let db = state.db.clone();
    let embedder = state.embedder.clone();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<AgentEvent>(100);
    tauri::async_runtime::spawn(async move { agent::run_agent(db, embedder, api_key, message, history, tx).await; });
    tauri::async_runtime::spawn(async move { while let Some(event) = rx.recv().await { let _ = app.emit("agent:event", &event); } });
    Ok(true)
}

// ── Notes ──

#[tauri::command]
pub async fn get_tweet_notes(state: State<'_, AppState>, tweet_id: String) -> Result<Vec<TweetNote>, String> {
    state.db.get_tweet_notes(&tweet_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_tweet_note(state: State<'_, AppState>, tweet_id: String, content: String) -> Result<TweetNote, String> {
    state.db.create_tweet_note(&tweet_id, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_tweet_note(state: State<'_, AppState>, note_id: i64, content: String) -> Result<bool, String> {
    state.db.update_tweet_note(note_id, &content).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn delete_tweet_note(state: State<'_, AppState>, note_id: i64) -> Result<bool, String> {
    state.db.delete_tweet_note(note_id).map_err(|e| e.to_string())?;
    Ok(true)
}

// ── Dots ──

#[tauri::command]
pub async fn list_dots(state: State<'_, AppState>) -> Result<Vec<Dot>, String> {
    state.db.list_dots().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_dot_detail(state: State<'_, AppState>, slug: String, limit: Option<u32>, offset: Option<u32>) -> Result<Option<DotDetail>, String> {
    state.db.get_dot_detail(&slug, limit.unwrap_or(50), offset.unwrap_or(0)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_dots(state: State<'_, AppState>, query: String, limit: Option<u32>) -> Result<Vec<Dot>, String> {
    state.db.search_dots_by_content(&query, limit.unwrap_or(20)).map_err(|e| e.to_string())
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

// ── Tweet webview (overlay on right half, main webview stays full size) ──

#[tauri::command]
pub async fn open_tweet_panel(app: tauri::AppHandle, url: String, _left_offset: f64, _height: f64, _width: f64) -> Result<bool, String> {
    use tauri::Manager;
    use tauri::webview::WebviewBuilder;

    let parsed_url: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;

    // If webview already exists, just navigate to the new URL (fast)
    if let Some(existing) = app.get_webview("tweet-panel") {
        existing.eval(&format!("window.location.href = '{}';", parsed_url)).map_err(|e| e.to_string())?;
        return Ok(true);
    }

    // First time: create the webview (offset 40px from top for control bar)
    let builder = WebviewBuilder::new("tweet-panel", tauri::WebviewUrl::External(parsed_url))
        .on_navigation(|_url| true)
        .initialization_script(r#"
            document.addEventListener('click', function(e) {
                const link = e.target.closest('a[target="_blank"]');
                if (link) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = link.href;
                }
            }, true);
            window.open = function(url) { if (url) window.location.href = url; };
        "#);

    let win = app.get_window("main").ok_or("No main window")?;
    let size = win.inner_size().map_err(|e| e.to_string())?;
    win.add_child(
        builder,
        tauri::Position::Physical(tauri::PhysicalPosition::new((size.width / 2) as i32, 0)),
        tauri::Size::Physical(tauri::PhysicalSize::new(size.width / 2, size.height)),
    ).map_err(|e| e.to_string())?;

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
        wv.eval("window.history.back()").map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub async fn webview_forward(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;
    if let Some(wv) = app.get_webview("tweet-panel") {
        wv.eval("window.history.forward()").map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub async fn open_in_browser(url: String) -> Result<bool, String> {
    open::that(&url).map_err(|e| e.to_string())?;
    Ok(true)
}
