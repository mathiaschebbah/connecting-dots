mod commands;
mod config;
mod db;
mod twitter;
mod workers;

use config::AppConfig;
use db::Database;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use workers::WorkerHandles;

pub struct AppState {
    pub db: Arc<Database>,
    pub config: Arc<Mutex<AppConfig>>,
    pub app_dir: std::path::PathBuf,
    pub workers: Arc<WorkerHandles>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let log_level = if cfg!(debug_assertions) {
                log::LevelFilter::Info
            } else {
                log::LevelFilter::Warn
            };
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log_level)
                    .build(),
            )?;

            let is_sandbox = std::env::var("CONNECTING_DOTS_DEV").is_ok();
            let app_dir = if is_sandbox {
                let dir = app
                    .path()
                    .app_data_dir()
                    .expect("failed to resolve app data dir")
                    .join("dev-sandbox");
                log::info!("DEV MODE: using sandbox at {:?}", dir);
                dir
            } else {
                app
                    .path()
                    .app_data_dir()
                    .expect("failed to resolve app data dir")
            };
            std::fs::create_dir_all(&app_dir)?;

            let config = AppConfig::load(&app_dir).unwrap_or_default();
            let db_path = app_dir.join("connecting-dots.db");
            let db = Database::open(&db_path).expect("failed to open database");
            let db = Arc::new(db);

            let worker_handles = Arc::new(WorkerHandles::new());
            workers::start_all(
                db.clone(),
                config.api_key().map(String::from),
                app.handle().clone(),
                &worker_handles,
            );

            app.manage(AppState {
                db,
                config: Arc::new(Mutex::new(config)),
                app_dir: app_dir.clone(),
                workers: worker_handles,
            });

            log::info!("Connecting Dots started. DB at {:?}", db_path);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Sync
            commands::sync_bookmarks,
            // Tweets
            commands::search_tweets,
            // AI
            commands::reset_enrichments,
            commands::check_api_key,
            commands::set_api_key,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if std::env::var("CONNECTING_DOTS_DEV").is_ok() {
                    if let Ok(dir) = app.path().app_data_dir() {
                        let sandbox = dir.join("dev-sandbox");
                        let _ = std::fs::remove_dir_all(&sandbox);
                        log::info!("DEV MODE: cleaned up sandbox");
                    }
                }
            }
        });
}
