pub mod enricher;
pub mod poller;

use crate::db::Database;
use crate::embeddings::Embedder;
use std::sync::Arc;

/// Start all background workers. They run until the process exits.
pub fn start_all(db: Arc<Database>, embedder: Arc<Embedder>, api_key: Option<String>) {
    // Boucle 1: poll bookmarks (~60s)
    tauri::async_runtime::spawn(poller::poll_loop(
        db.clone(),
        embedder.clone(),
        poller::PollConfig {
            source: poller::PollSource::Bookmarks,
            interval_secs: 60,
        },
    ));

    // Boucle 1: poll feed (~60s)
    tauri::async_runtime::spawn(poller::poll_loop(
        db.clone(),
        embedder.clone(),
        poller::PollConfig {
            source: poller::PollSource::Feed,
            interval_secs: 60,
        },
    ));

    // Boucle 2: enrichissement IA (si clé API fournie)
    if let Some(key) = api_key {
        tauri::async_runtime::spawn(enricher::enrich_loop(db.clone(), key));
    }
}
