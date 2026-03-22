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
                app.handle().clone(),
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
            commands::list_tags,
            commands::create_and_assign_tag,
            commands::remove_tag_from_tweet,
            commands::send_agent_message,
            commands::get_network_graph,
            commands::list_tweets_by_category,
            commands::get_dashboard_stats,
            // Projects
            commands::list_projects,
            commands::create_project,
            commands::delete_project,
            // Kanban
            commands::list_kanban_columns,
            commands::create_kanban_column,
            commands::delete_kanban_column,
            commands::list_kanban_cards,
            commands::create_kanban_card,
            commands::move_kanban_card,
            commands::delete_kanban_card,
            // Monitored topics
            commands::list_monitored_topics,
            commands::delete_monitored_topic,
            // Groups
            commands::list_groups,
            commands::create_group,
            commands::delete_group,
            commands::add_tweet_to_group,
            commands::remove_tweet_from_group,
            commands::get_group_tweets,
            // Tweet notes
            commands::get_tweet_notes,
            commands::create_tweet_note,
            commands::update_tweet_note,
            commands::delete_tweet_note,
            // Pinned accounts
            commands::list_pinned_accounts,
            commands::pin_account,
            commands::unpin_account,
            commands::get_account_tweets,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
