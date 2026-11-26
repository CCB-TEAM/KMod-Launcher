use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const DEFAULT_PACKAGE: &str = "com.android1939.kardsapk";

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
    /// Mod catalogue addresses, one per line; empty = the official index.
    pub index_url: String,
    /// Id of the selected theme (built-in or one of `custom_themes`).
    pub theme: String,
    /// User-made themes; the frontend owns their shape.
    pub custom_themes: Vec<serde_json::Value>,
    /// File name of the custom app icon inside the config directory; empty = built-in icon.
    pub icon: String,
    /// Android: package name of the patched game.
    pub package: String,
    /// The first-start guide has been finished or skipped.
    pub onboarded: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            game_dir: String::new(),
            flavor: "release".into(),
            prereleases: true,
            proxy: String::new(),
            mirror: String::new(),
            index_url: String::new(),
            theme: "violet".into(),
            custom_themes: Vec::new(),
            icon: String::new(),
            package: DEFAULT_PACKAGE.into(),
            onboarded: false,
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
        .and_then(|s| parse(&s))
        .unwrap_or_default()
}

fn parse(text: &str) -> Option<Config> {
    let mut v: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    // settings written before the guide existed belong to someone who has been using the launcher: do not show it
    v.as_object_mut()?.entry("onboarded").or_insert(true.into());
    serde_json::from_value(v).ok()
}

pub fn save(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path(app)?, text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_first_start_sees_the_guide() {
        assert!(!Config::default().onboarded);
        assert!(parse(r#"{"theme":"ocean"}"#).unwrap().onboarded);
        assert!(!parse(r#"{"onboarded":false}"#).unwrap().onboarded);
    }
}
