pub mod enricher;
pub mod link_resolver;
pub mod poller;

use crate::db::Database;
use crate::embeddings::Embedder;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Sync activity event emitted to frontend
#[derive(Debug, serde::Serialize, Clone)]
pub struct SyncEvent {
    pub worker: String,
    pub status: String, // "start" | "done"
    pub detail: Option<String>,
}

/// Start all background workers. They run until the process exits.
pub fn start_all(db: Arc<Database>, embedder: Arc<Embedder>, api_key: Option<String>, app_handle: AppHandle) {
    // Boucle 1: poll bookmarks (~60s)
    {
        let handle = app_handle.clone();
        tauri::async_runtime::spawn(poller::poll_loop_with_events(
            db.clone(),
            embedder.clone(),
            poller::PollConfig {
                source: poller::PollSource::Bookmarks,
                interval_secs: 60,
            },
            handle,
        ));
    }

    // Boucle 2: poll feed (~60s)
    {
        let handle = app_handle.clone();
        tauri::async_runtime::spawn(poller::poll_loop_with_events(
            db.clone(),
            embedder.clone(),
            poller::PollConfig {
                source: poller::PollSource::Feed,
                interval_secs: 60,
            },
            handle,
        ));
    }

    // Boucle 3: monitored topics (~60s)
    {
        let db2 = db.clone();
        let emb2 = embedder.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                poller::poll_monitored_topics(&db2, &emb2).await;
                tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            }
        });
    }

    // Boucle 4: enrichissement IA (si clé API fournie)
    if let Some(key) = api_key {
        let handle = app_handle.clone();
        tauri::async_runtime::spawn(enricher::enrich_loop_with_events(db.clone(), key, handle));
    }

    // Boucle 5: link resolver (~30s)
    {
        let handle = app_handle.clone();
        tauri::async_runtime::spawn(link_resolver::resolve_loop_with_events(db.clone(), handle));
    }
}
