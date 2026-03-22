use crate::db::Database;
use crate::embeddings::Embedder;
use crate::twitter::clix::Clix;
use std::sync::Arc;
use tokio::sync::watch;
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

pub async fn poll_loop(
    db: Arc<Database>,
    embedder: Arc<Embedder>,
    mut shutdown: watch::Receiver<bool>,
    config: PollConfig,
) {
    let source_name = match config.source {
        PollSource::Bookmarks => "bookmarks",
        PollSource::Feed => "feed",
    };

    log::info!("Worker started: poll {} every {}s", source_name, config.interval_secs);

    loop {
        // Check shutdown
        if *shutdown.borrow() {
            log::info!("Worker {} shutting down", source_name);
            return;
        }

        // Poll
        match poll_once(&db, &embedder, &config.source).await {
            Ok((new, embedded)) => {
                if new > 0 {
                    log::info!("[{}] +{} tweets, {} embedded", source_name, new, embedded);
                }
            }
            Err(e) => {
                log::error!("[{}] poll error: {}", source_name, e);
            }
        }

        // Wait for next poll or shutdown
        tokio::select! {
            _ = sleep(Duration::from_secs(config.interval_secs)) => {},
            _ = shutdown.changed() => {
                log::info!("Worker {} shutting down", source_name);
                return;
            }
        }
    }
}

async fn poll_once(
    db: &Database,
    embedder: &Embedder,
    source: &PollSource,
) -> anyhow::Result<(u32, u32)> {
    let clix = Clix::new();

    // Fetch tweets from Twitter
    let tweets = match source {
        PollSource::Bookmarks => {
            tokio::task::spawn_blocking(move || clix.bookmarks(100)).await??
        }
        PollSource::Feed => {
            tokio::task::spawn_blocking(move || clix.feed("following", 100)).await??
        }
    };

    let source_name = match source {
        PollSource::Bookmarks => "bookmark",
        PollSource::Feed => "feed",
    };

    // Store in DB (dedup)
    let new_count = db.upsert_tweets(&tweets, source_name)?;

    // Embed any tweets without embeddings (batch of 50)
    let mut embedded_count = 0u32;
    let pending = db.tweets_without_embedding(50)?;
    if !pending.is_empty() {
        let texts: Vec<String> = pending.iter().map(|(_, content)| content.clone()).collect();
        let embeddings = embedder.embed_batch(&texts)?;
        for ((tweet_id, _), embedding) in pending.iter().zip(embeddings.iter()) {
            db.store_embedding(tweet_id, embedding)?;
            embedded_count += 1;
        }
    }

    Ok((new_count, embedded_count))
}
