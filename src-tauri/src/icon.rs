//! Custom app icon: a PNG or ICO the user picked, kept in the config folder.
//! It is shown in the launcher UI and set as the window / taskbar icon.

use crate::config;
use base64::Engine;
use std::path::PathBuf;
use tauri::{image::Image, AppHandle, Manager};

const MAX_BYTES: u64 = 8 * 1024 * 1024;

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn kind_of(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some(("png", "image/png"))
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        Some(("ico", "image/x-icon"))
    } else {
        None
    }
}

/// Puts the saved icon on the window; called at start and after a change.
#[cfg(mobile)]
pub fn apply(_app: &AppHandle) {}

#[cfg(desktop)]
pub fn apply(app: &AppHandle) {
    let cfg = config::load(app);
    let Some(win) = app.get_webview_window("main") else { return };
    if cfg.icon.is_empty() {
        if let Some(def) = app.default_window_icon() {
            let _ = win.set_icon(def.clone());
        }
        return;
    }
    let Ok(d) = dir(app) else { return };
    if let Ok(bytes) = std::fs::read(d.join(&cfg.icon)) {
        if let Ok(img) = Image::from_bytes(&bytes) {
            let _ = win.set_icon(img);
        }
    }
}

/// Data URL of the custom icon, or null when the built-in one is in use.
pub fn data_url(app: &AppHandle) -> Option<String> {
    let cfg = config::load(app);
    if cfg.icon.is_empty() {
        return None;
    }
    let bytes = std::fs::read(dir(app).ok()?.join(&cfg.icon)).ok()?;
    let (_, mime) = kind_of(&bytes)?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

pub fn set(app: &AppHandle, source: &str) -> Result<(), String> {
    let meta = std::fs::metadata(source).map_err(|e| e.to_string())?;
    if meta.len() > MAX_BYTES {
        return Err("图标文件太大（最多 8 MB）".into());
    }
    let bytes = std::fs::read(source).map_err(|e| e.to_string())?;
    let (ext, _) = kind_of(&bytes).ok_or("只支持 PNG 或 ICO 图标")?;
    Image::from_bytes(&bytes).map_err(|e| format!("读不出这个图标：{e}"))?;
    let d = dir(app)?;
    let name = format!("custom-icon.{ext}");
    std::fs::write(d.join(&name), &bytes).map_err(|e| e.to_string())?;
    let other = if ext == "png" { "custom-icon.ico" } else { "custom-icon.png" };
    let _ = std::fs::remove_file(d.join(other));
    let mut cfg = config::load(app);
    cfg.icon = name;
    config::save(app, &cfg)?;
    apply(app);
    Ok(())
}

pub fn reset(app: &AppHandle) -> Result<(), String> {
    let d = dir(app)?;
    let _ = std::fs::remove_file(d.join("custom-icon.png"));
    let _ = std::fs::remove_file(d.join("custom-icon.ico"));
    let mut cfg = config::load(app);
    cfg.icon = String::new();
    config::save(app, &cfg)?;
    apply(app);
    Ok(())
}
