pub mod enricher;
pub mod link_resolver;
pub mod poller;

use crate::config::AppConfig;
use crate::db::Database;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri::async_runtime::JoinHandle;

#[derive(Debug, serde::Serialize, Clone)]
pub struct SyncEvent {
    pub worker: String,
    pub status: String,
    pub detail: Option<String>,
}

pub struct WorkerHandles {
    handles: Mutex<Vec<JoinHandle<()>>>,
}

impl WorkerHandles {
    pub fn new() -> Self {
        Self {
            handles: Mutex::new(Vec::new()),
        }
    }

    pub fn stop_all(&self) {
        let mut handles = self.handles.lock().unwrap_or_else(|p| p.into_inner());
        for handle in handles.drain(..) {
            handle.abort();
        }
    }
}

pub fn start_all(
    db: Arc<Database>,
    api_key: Option<String>,
    app_handle: AppHandle,
    worker_handles: &WorkerHandles,
    config: Option<Arc<Mutex<AppConfig>>>,
    app_dir: Option<std::path::PathBuf>,
) {
    worker_handles.stop_all();

    let mut new_handles = Vec::new();

    // Bookmarks polling (~300s)
    {
        let handle = app_handle.clone();
        let cfg = config.clone();
        new_handles.push(tauri::async_runtime::spawn(poller::poll_loop_with_events(
            db.clone(),
            poller::PollConfig { interval_secs: 300 },
            handle,
            cfg,
        )));
    }

    // AI enrichment (~15s, requires API key)
    if let Some(key) = api_key {
        let handle = app_handle.clone();
        let cfg = config.clone();
        let dir = app_dir.clone();
        new_handles.push(tauri::async_runtime::spawn(
            enricher::enrich_loop_with_events(db.clone(), key, handle, cfg, dir),
        ));
    }

    // Link resolver (~30s)
    {
        let handle = app_handle.clone();
        let cfg = config.clone();
        new_handles.push(tauri::async_runtime::spawn(
            link_resolver::resolve_loop_with_events(db.clone(), handle, cfg),
        ));
    }

    let mut handles = worker_handles
        .handles
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    *handles = new_handles;
}
