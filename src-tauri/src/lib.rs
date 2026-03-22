mod agent;
mod commands;
mod db;
mod embeddings;
mod twitter;
mod workers;

use db::Database;
use std::sync::Arc;
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Database>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize database
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir)?;
            let db_path = app_dir.join("connecting-dots.db");
            let db = Database::open(&db_path).expect("failed to open database");

            app.manage(AppState { db: Arc::new(db) });

            log::info!("Connecting Dots started. DB at {:?}", db_path);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
