use crate::db::Database;
use crate::embeddings::Embedder;
use crate::twitter::bookmarks_fetcher::BookmarksFetcher;
use crate::twitter::clix::Clix;
use std::sync::Arc;
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

pub async fn poll_loop(db: Arc<Database>, embedder: Arc<Embedder>, config: PollConfig) {
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
