pub mod enricher;
pub mod link_resolver;
pub mod poller;

use crate::db::Database;
use crate::embeddings::Embedder;
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Debug, serde::Serialize, Clone)]
pub struct SyncEvent {
    pub worker: String,
    pub status: String,
    pub detail: Option<String>,
}

pub fn start_all(db: Arc<Database>, embedder: Arc<Embedder>, api_key: Option<String>, app_handle: AppHandle) {
    // Bookmarks polling (~60s)
    {
        let handle = app_handle.clone();
        tauri::async_runtime::spawn(poller::poll_loop_with_events(
            db.clone(), embedder.clone(),
            poller::PollConfig { interval_secs: 300 },
            handle,
        ));
    }

    // AI enrichment (~15s, requires API key)
    if let Some(key) = api_key {
        let handle = app_handle.clone();
        tauri::async_runtime::spawn(enricher::enrich_loop_with_events(db.clone(), key, handle));
    }

    // Link resolver (~30s)
    {
        let handle = app_handle.clone();
        tauri::async_runtime::spawn(link_resolver::resolve_loop_with_events(db.clone(), handle));
    }
}
