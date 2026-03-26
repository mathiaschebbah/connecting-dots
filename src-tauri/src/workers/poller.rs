use crate::config::AppConfig;
use crate::db::Database;
use crate::twitter::bookmarks_fetcher::BookmarksFetcher;
use crate::workers::SyncEvent;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

#[derive(Clone)]
pub struct PollConfig {
    pub interval_secs: u64,
}

pub async fn poll_loop_with_events(
    db: Arc<Database>,
    config: PollConfig,
    app_handle: AppHandle,
    app_config: Option<Arc<Mutex<AppConfig>>>,
) {
    log::info!(
        "Worker started: poll bookmarks every {}s",
        config.interval_secs
    );

    loop {
        let _ = app_handle.emit(
            "sync:event",
            SyncEvent {
                worker: "bookmarks".to_string(),
                status: "start".to_string(),
                detail: None,
            },
        );

        match poll_bookmarks(&db, &app_config).await {
            Ok(new) => {
                let detail = if new > 0 {
                    log::info!("[bookmarks] +{} tweets", new);
                    Some(format!("+{} signets", new))
                } else {
                    None
                };
                let _ = app_handle.emit(
                    "sync:event",
                    SyncEvent {
                        worker: "bookmarks".to_string(),
                        status: "done".to_string(),
                        detail,
                    },
                );
            }
            Err(e) => {
                log::error!("[bookmarks] poll error: {}", e);
                let _ = app_handle.emit(
                    "sync:event",
                    SyncEvent {
                        worker: "bookmarks".to_string(),
                        status: "done".to_string(),
                        detail: Some(format!("error: {}", e)),
                    },
                );
            }
        }

        sleep(Duration::from_secs(config.interval_secs)).await;
    }
}

async fn poll_bookmarks(
    db: &Database,
    app_config: &Option<Arc<Mutex<AppConfig>>>,
) -> anyhow::Result<u32> {
    let stored = app_config
        .as_ref()
        .and_then(|c| c.lock().ok())
        .and_then(|c| c.x_cookies.clone());

    let tweets = tokio::task::spawn_blocking(move || {
        let cookies = stored.ok_or_else(|| anyhow::anyhow!("No stored X cookies"))?;
        let fetcher = BookmarksFetcher::new(cookies.ct0, cookies.cookies_str);
        fetcher.fetch_all(50)
    })
    .await??;

    let new_count = db.upsert_tweets(&tweets, "bookmark")?;

    let ids: Vec<String> = tweets.iter().map(|t| t.id.clone()).collect();
    db.set_bookmark_order(&ids)?;

    Ok(new_count)
}
