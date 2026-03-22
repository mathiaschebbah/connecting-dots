mod agent;
mod commands;
mod config;
mod db;
mod embeddings;
mod twitter;
mod workers;

use config::AppConfig;
use db::Database;
use embeddings::Embedder;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Database>,
    pub embedder: Arc<Embedder>,
    pub config: Arc<Mutex<AppConfig>>,
    pub app_dir: std::path::PathBuf,
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

            // App data directory
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir)?;

            // Load config
            let config = AppConfig::load(&app_dir).unwrap_or_default();

            // Initialize database
            let db_path = app_dir.join("connecting-dots.db");
            let db = Database::open(&db_path).expect("failed to open database");
            let db = Arc::new(db);

            // Initialize embedder (downloads model on first run)
            let embedder = Embedder::new().expect("failed to initialize embedding model");
            let embedder = Arc::new(embedder);

            // Start background workers (always — enrichment only if API key present)
            workers::start_all(
                db.clone(),
                embedder.clone(),
                config.api_key().map(String::from),
            );

            app.manage(AppState {
                db,
                embedder,
                config: Arc::new(Mutex::new(config)),
                app_dir: app_dir.clone(),
            });

            log::info!("Connecting Dots started. DB at {:?}", db_path);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sync_bookmarks,
            commands::sync_feed,
            commands::list_tweets,
            commands::search_tweets,
            commands::search_semantic,
            commands::get_tweet_count,
            commands::embed_pending,
            commands::check_api_key,
            commands::set_api_key,
            commands::get_tweet_detail,
            commands::get_network_graph,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
