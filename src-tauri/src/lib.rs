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

            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir)?;

            let config = AppConfig::load(&app_dir).unwrap_or_default();
            let db_path = app_dir.join("connecting-dots.db");
            let db = Database::open(&db_path).expect("failed to open database");
            let db = Arc::new(db);
            let embedder = Embedder::new().expect("failed to initialize embedding model");
            let embedder = Arc::new(embedder);

            workers::start_all(
                db.clone(),
                embedder.clone(),
                config.api_key().map(String::from),
                app.handle().clone(),
            );

            app.manage(AppState {
                db,
                embedder,
                config: Arc::new(Mutex::new(config)),
                app_dir: app_dir.clone(),
            });

            log::info!("Connecting Dots V2 started. DB at {:?}", db_path);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Sync
            commands::sync_bookmarks,
            // Tweets
            commands::list_tweets,
            commands::search_tweets,
            commands::search_semantic,
            commands::get_tweet_count,
            // Embeddings
            commands::embed_pending,
            // AI
            commands::reset_enrichments,
            commands::check_api_key,
            commands::set_api_key,
            // Detail
            commands::get_tweet_detail,
            commands::get_thread,
            // Tags
            commands::list_tags,
            commands::create_and_assign_tag,
            commands::remove_tag_from_tweet,
            // Agent
            commands::send_agent_message,
            // Notes
            commands::get_tweet_notes,
            commands::create_tweet_note,
            commands::update_tweet_note,
            commands::delete_tweet_note,
            // Dots
            commands::list_dots,
            commands::get_dot_detail,
            commands::move_tweet_dot,
            commands::rename_dot,
            commands::delete_dot,
            commands::create_dot,
            commands::get_all_dot_slugs,
            commands::search_dots,
            commands::backfill_dots,
            // Dashboard
            commands::get_dashboard_stats,
            // Tweet panel
            commands::open_tweet_panel,
            commands::close_tweet_panel,
            commands::webview_back,
            commands::webview_forward,
            commands::open_in_browser,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
