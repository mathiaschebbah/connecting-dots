use crate::db::Database;
use crate::embeddings::Embedder;
use crate::twitter::bookmarks_fetcher::BookmarksFetcher;
use crate::twitter::clix::Clix;
use crate::workers::SyncEvent;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

#[derive(Clone)]
pub enum PollSource {
    Bookmarks,
    Feed,
}

#[derive(Clone)]
pub struct PollConfig {
    pub source: PollSource,
    pub interval_secs: u64,
}

pub async fn poll_loop_with_events(db: Arc<Database>, embedder: Arc<Embedder>, config: PollConfig, app_handle: AppHandle) {
    let source_name = match config.source {
        PollSource::Bookmarks => "bookmarks",
        PollSource::Feed => "feed",
    };

    log::info!(
        "Worker started: poll {} every {}s",
        source_name,
        config.interval_secs
    );

    loop {
        let _ = app_handle.emit("sync:event", SyncEvent {
            worker: source_name.to_string(),
            status: "start".to_string(),
            detail: None,
        });

        match poll_once(&db, &embedder, &config.source).await {
            Ok((new, embedded)) => {
                let detail = if new > 0 {
                    log::info!("[{}] +{} tweets, {} embedded", source_name, new, embedded);
                    Some(format!("+{} tweets", new))
                } else {
                    None
                };
                let _ = app_handle.emit("sync:event", SyncEvent {
                    worker: source_name.to_string(),
                    status: "done".to_string(),
                    detail,
                });
            }
            Err(e) => {
                log::error!("[{}] poll error: {}", source_name, e);
                let _ = app_handle.emit("sync:event", SyncEvent {
                    worker: source_name.to_string(),
                    status: "done".to_string(),
                    detail: Some(format!("error: {}", e)),
                });
            }
        }

        sleep(Duration::from_secs(config.interval_secs)).await;
    }
}

async fn poll_once(
    db: &Database,
    embedder: &Embedder,
    source: &PollSource,
) -> anyhow::Result<(u32, u32)> {
    // Fetch tweets from Twitter
    let tweets = match source {
        PollSource::Bookmarks => {
            // Use direct GraphQL fetcher for bookmarks (paginated, gets ALL)
            tokio::task::spawn_blocking(|| {
                let fetcher = BookmarksFetcher::from_clix_config()?;
                fetcher.fetch_all(20) // up to 20 pages (~2000 bookmarks)
            })
            .await??
        }
        PollSource::Feed => {
            let clix = Clix::new();
            tokio::task::spawn_blocking(move || clix.feed("following", 100)).await??
        }
    };

    let source_name = match source {
        PollSource::Bookmarks => "bookmark",
        PollSource::Feed => "feed",
    };

    // Store in DB (dedup)
    let new_count = db.upsert_tweets(&tweets, source_name)?;

    // Set bookmark ordering (API returns most recent first = index 0)
    if matches!(source, PollSource::Bookmarks) {
        let ids: Vec<String> = tweets.iter().map(|t| t.id.clone()).collect();
        db.set_bookmark_order(&ids)?;
    }

    // Embed any tweets without embeddings (batch of 50)
    let mut embedded_count = 0u32;
    let pending = db.tweets_without_embedding(50)?;
    if !pending.is_empty() {
        let texts: Vec<String> = pending.iter().map(|(_, content)| content.clone()).collect();
        let embeddings = embedder.embed_batch(&texts)?;
        for ((tweet_id, _), embedding) in pending.iter().zip(embeddings.iter()) {
            if let Err(e) = db.store_embedding(tweet_id, embedding) {
                log::warn!("Failed to store embedding for {}: {}", tweet_id, e);
            } else {
                embedded_count += 1;
            }
        }
    }

    Ok((new_count, embedded_count))
}

/// Poll monitored topics: search Twitter for each due topic and upsert results
pub async fn poll_monitored_topics(db: &Database, embedder: &Embedder) {
    let topics = match db.get_due_monitored_topics() {
        Ok(t) => t,
        Err(e) => {
            log::warn!("Failed to get due topics: {}", e);
            return;
        }
    };

    for topic in topics {
        let query = topic.query.clone();
        let topic_id = topic.id;
        log::info!("[monitor] Searching for topic: {}", query);

        let result = tokio::task::spawn_blocking(move || {
            let clix = Clix::new();
            clix.search(&query, 20)
        })
        .await;

        match result {
            Ok(Ok(tweets)) => {
                let count = db.upsert_tweets(&tweets, "feed").unwrap_or(0);
                if count > 0 {
                    log::info!("[monitor] '{}': +{} new tweets", topic.query, count);
                    // Embed new tweets
                    let pending = db.tweets_without_embedding(50).unwrap_or_default();
                    if !pending.is_empty() {
                        let texts: Vec<String> = pending.iter().map(|(_, c)| c.clone()).collect();
                        if let Ok(embeddings) = embedder.embed_batch(&texts) {
                            for ((id, _), emb) in pending.iter().zip(embeddings.iter()) {
                                let _ = db.store_embedding(id, emb);
                            }
                        }
                    }
                }
                let _ = db.update_topic_polled(topic_id);
            }
            Ok(Err(e)) => log::warn!("[monitor] '{}' search error: {}", topic.query, e),
            Err(e) => log::warn!("[monitor] '{}' task error: {}", topic.query, e),
        }
    }
}
