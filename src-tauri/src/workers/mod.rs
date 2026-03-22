pub mod poller;
pub mod enricher;

use crate::db::Database;
use crate::embeddings::Embedder;
use std::sync::Arc;
use tokio::sync::watch;

pub struct WorkerHandle {
    shutdown_tx: watch::Sender<bool>,
}

impl WorkerHandle {
    pub fn shutdown(&self) {
        let _ = self.shutdown_tx.send(true);
    }
}

/// Start all background workers. Returns a handle to stop them.
pub fn start_all(
    db: Arc<Database>,
    embedder: Arc<Embedder>,
    api_key: Option<String>,
) -> WorkerHandle {
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // Boucle 1: poll bookmarks (~60s)
    tokio::spawn(poller::poll_loop(
        db.clone(),
        embedder.clone(),
        shutdown_rx.clone(),
        poller::PollConfig {
            source: poller::PollSource::Bookmarks,
            interval_secs: 60,
        },
    ));

    // Boucle 1: poll feed (~60s)
    tokio::spawn(poller::poll_loop(
        db.clone(),
        embedder.clone(),
        shutdown_rx.clone(),
        poller::PollConfig {
            source: poller::PollSource::Feed,
            interval_secs: 60,
        },
    ));

    // Boucle 2: enrichissement IA (si clé API fournie)
    if let Some(key) = api_key {
        tokio::spawn(enricher::enrich_loop(
            db.clone(),
            key,
            shutdown_rx.clone(),
        ));
    }

    WorkerHandle { shutdown_tx }
}
