use crate::db::Database;
use crate::embeddings::Embedder;
use crate::twitter::bookmarks_fetcher::BookmarksFetcher;
use crate::workers::SyncEvent;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

#[derive(Clone)]
pub struct PollConfig {
    pub interval_secs: u64,
}

pub async fn poll_loop_with_events(db: Arc<Database>, embedder: Arc<Embedder>, config: PollConfig, app_handle: AppHandle) {
    log::info!("Worker started: poll bookmarks every {}s", config.interval_secs);

    loop {
        let _ = app_handle.emit("sync:event", SyncEvent {
            worker: "bookmarks".to_string(),
            status: "start".to_string(),
            detail: None,
        });

        match poll_bookmarks(&db, &embedder).await {
            Ok((new, embedded)) => {
                let detail = if new > 0 {
                    log::info!("[bookmarks] +{} tweets, {} embedded", new, embedded);
                    Some(format!("+{} signets", new))
                } else { None };
                let _ = app_handle.emit("sync:event", SyncEvent {
                    worker: "bookmarks".to_string(),
                    status: "done".to_string(),
                    detail,
                });
            }
            Err(e) => {
                log::error!("[bookmarks] poll error: {}", e);
                let _ = app_handle.emit("sync:event", SyncEvent {
                    worker: "bookmarks".to_string(),
                    status: "done".to_string(),
                    detail: Some(format!("error: {}", e)),
                });
            }
        }

        sleep(Duration::from_secs(config.interval_secs)).await;
    }
}

async fn poll_bookmarks(db: &Database, embedder: &Embedder) -> anyhow::Result<(u32, u32)> {
    let tweets = tokio::task::spawn_blocking(|| {
        let fetcher = BookmarksFetcher::from_clix_config()?;
        fetcher.fetch_all(50)
    }).await??;

    let new_count = db.upsert_tweets(&tweets, "bookmark")?;

    let ids: Vec<String> = tweets.iter().map(|t| t.id.clone()).collect();
    db.set_bookmark_order(&ids)?;

    let mut embedded_count = 0u32;
    let pending = db.tweets_without_embedding(50)?;
    if !pending.is_empty() {
        let texts: Vec<String> = pending.iter().map(|(_, content)| content.clone()).collect();
        let embeddings = embedder.embed_batch(&texts)?;
        for ((tweet_id, _), embedding) in pending.iter().zip(embeddings.iter()) {
            if db.store_embedding(tweet_id, embedding).is_ok() {
                embedded_count += 1;
            }
        }
    }

    Ok((new_count, embedded_count))
}
