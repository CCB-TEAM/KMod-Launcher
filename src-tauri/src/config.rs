use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Launcher settings, stored as JSON in the app config directory.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Config {
    /// The `Binaries\Win64` folder of the selected KARDS install.
    pub game_dir: String,
    /// "release" or "dev".
    pub flavor: String,
    /// Offer pre-releases of the loader.
    pub prereleases: bool,
    /// Optional proxy URL (http://host:port or socks5://host:port). Empty = system environment.
    pub proxy: String,
    /// Optional prefix put in front of GitHub download URLs (a mirror).
    pub mirror: String,
    /// Id of the selected theme (built-in or one of `custom_themes`).
    pub theme: String,
    /// User-made themes; the frontend owns their shape.
    pub custom_themes: Vec<serde_json::Value>,
    /// File name of the custom app icon inside the config directory; empty = built-in icon.
    pub icon: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            game_dir: String::new(),
            flavor: "release".into(),
            prereleases: true,
            proxy: String::new(),
            mirror: String::new(),
            theme: "violet".into(),
            custom_themes: Vec::new(),
            icon: String::new(),
        }
    }
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

pub fn load(app: &AppHandle) -> Config {
    path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path(app)?, text).map_err(|e| e.to_string())
}
