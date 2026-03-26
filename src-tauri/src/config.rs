use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct AppConfig {
    pub anthropic_api_key: Option<String>,
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
}
