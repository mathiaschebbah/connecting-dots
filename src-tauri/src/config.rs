use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoredCookies {
    pub ct0: String,
    pub cookies_str: String,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct AppConfig {
    pub anthropic_api_key: Option<String>,
    #[serde(default)]
    pub x_cookies: Option<StoredCookies>,
    #[serde(default)]
    pub api_usage_input_tokens: u64,
    #[serde(default)]
    pub api_usage_output_tokens: u64,
}

impl AppConfig {
    pub fn load(app_dir: &Path) -> Result<Self> {
        let config_path = app_dir.join("config.json");
        if config_path.exists() {
            let data = std::fs::read_to_string(&config_path)?;
            let config: AppConfig = serde_json::from_str(&data)?;
            Ok(config)
        } else {
            Ok(AppConfig::default())
        }
    }

    pub fn save(&self, app_dir: &Path) -> Result<()> {
        let path = app_dir.join("config.json");
        let tmp_path = app_dir.join("config.json.tmp");
        let data = serde_json::to_string_pretty(self)?;
        std::fs::write(&tmp_path, &data)?;
        let _ = std::fs::remove_file(&path);
        std::fs::rename(&tmp_path, &path)?;
        Ok(())
    }

    pub fn has_api_key(&self) -> bool {
        self.anthropic_api_key
            .as_ref()
            .map(|k| !k.is_empty())
            .unwrap_or(false)
    }

    pub fn api_key(&self) -> Option<&str> {
        self.anthropic_api_key.as_deref().filter(|k| !k.is_empty())
    }

    pub fn add_usage(&mut self, input_tokens: u64, output_tokens: u64) {
        self.api_usage_input_tokens += input_tokens;
        self.api_usage_output_tokens += output_tokens;
    }

    pub fn estimated_cost_usd(&self) -> f64 {
        let input_cost = self.api_usage_input_tokens as f64 * 0.80 / 1_000_000.0;
        let output_cost = self.api_usage_output_tokens as f64 * 4.0 / 1_000_000.0;
        input_cost + output_cost
    }
}
