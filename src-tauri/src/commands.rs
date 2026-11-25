use crate::config::{self, Config};
use crate::game::{self, kmod_dir, EXE};
use crate::install::{self, InstallState};
use crate::mods::{self, ModInfo};
use crate::paks;
use crate::net::{self, Release};
use std::path::PathBuf;
use tauri::AppHandle;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn win64(app: &AppHandle) -> Result<PathBuf, String> {
    let cfg = config::load(app);
    game::normalize(&cfg.game_dir).ok_or_else(|| "还没有选择游戏目录".to_string())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_config(app: AppHandle) -> Config {
    config::load(&app)
}

#[tauri::command]
pub fn save_config(app: AppHandle, mut config: Config) -> Result<Config, String> {
    // Keep a normalized game folder so every later call can rely on it.
    if !config.game_dir.trim().is_empty() {
        config.game_dir = game::normalize(&config.game_dir)
            .ok_or("这个目录里没有 kards-Win64-Shipping.exe")?
            .to_string_lossy()
            .to_string();
    }
    if config.flavor != "dev" {
        config.flavor = "release".into();
    }
    config::save(&app, &config)?;
    Ok(config)
}

#[tauri::command]
pub async fn detect_games() -> Result<Vec<String>, String> {
    blocking(|| Ok(game::detect())).await
}

/// Returns the normalized `Binaries\Win64` folder, or null when the path holds no game.
#[tauri::command]
pub fn check_game(path: String) -> Option<String> {
    game::normalize(&path).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn game_running() -> bool {
    let mut cmd = std::process::Command::new("tasklist");
    cmd.args(["/FI", &format!("IMAGENAME eq {EXE}"), "/NH"]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains(&EXE.to_lowercase()))
        .unwrap_or(false)
}

#[tauri::command]
pub fn launch_game(app: AppHandle) -> Result<(), String> {
    let dir = win64(&app)?;
    if game_running() {
        return Err("游戏已经在运行".into());
    }
    std::process::Command::new(dir.join(EXE))
        .current_dir(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("启动失败：{e}"))
}

#[tauri::command]
pub fn get_installed(app: AppHandle) -> Result<InstallState, String> {
    Ok(install::state(&win64(&app)?))
}

#[tauri::command]
pub async fn list_releases(app: AppHandle) -> Result<Vec<Release>, String> {
    let cfg = config::load(&app);
    blocking(move || net::fetch_releases(&cfg)).await
}

#[tauri::command]
pub async fn install_loader(
    app: AppHandle,
    url: String,
    size: u64,
    tag: String,
    flavor: String,
    replace_foreign: bool,
) -> Result<(), String> {
    let cfg = config::load(&app);
    let dir = win64(&app)?;
    // Only ever download from the loader's own GitHub releases.
    let prefix = format!("https://github.com/{}/releases/download/", net::REPO);
    if !url.starts_with(&prefix) {
        return Err("下载地址不是官方发布页".into());
    }
    if game_running() {
        return Err("游戏正在运行，请先关闭游戏".into());
    }
    blocking(move || install::install(&app, &cfg, &dir, &url, size, &tag, &flavor, replace_foreign)).await
}

#[tauri::command]
pub fn uninstall_loader(app: AppHandle, remove_data: bool) -> Result<(), String> {
    if game_running() {
        return Err("游戏正在运行，请先关闭游戏".into());
    }
    install::uninstall(&win64(&app)?, remove_data)
}

#[tauri::command]
pub fn list_mods(app: AppHandle) -> Result<Vec<ModInfo>, String> {
    let dir = win64(&app)?;
    let mut all = mods::list(&dir);
    all.extend(paks::list(&dir));
    Ok(all)
}

#[tauri::command]
pub fn set_mod_enabled(app: AppHandle, id: String, enabled: bool, kind: String) -> Result<(), String> {
    let dir = win64(&app)?;
    if kind == "pak" {
        if game_running() {
            return Err("游戏正在运行，请先关闭游戏".into());
        }
        return paks::set_enabled(&dir, &id, enabled);
    }
    mods::set_enabled(&dir, &id, enabled)
}

#[tauri::command]
pub fn install_mod(app: AppHandle, source: String) -> Result<String, String> {
    let dir = win64(&app)?;
    if source.to_lowercase().ends_with(".pak") {
        return paks::install(&dir, &source);
    }
    mods::install(&dir, &source)
}

#[tauri::command]
pub fn delete_mod(app: AppHandle, file: String, id: String, kind: String) -> Result<(), String> {
    let dir = win64(&app)?;
    if kind == "pak" {
        if game_running() {
            return Err("游戏正在运行，请先关闭游戏".into());
        }
        return paks::delete(&dir, &file);
    }
    mods::delete(&dir, &file, &id)
}

/// Last part of the loader log (about 200 KB).
#[tauri::command]
pub fn read_log(app: AppHandle, name: String) -> Result<String, String> {
    let file = match name.as_str() {
        "proxy" => kmod_dir(&win64(&app)?).join("proxy.log"),
        _ => kmod_dir(&win64(&app)?).join("logs").join("kmod.log"),
    };
    let data = match std::fs::read(&file) {
        Ok(d) => d,
        Err(_) => return Ok(String::new()),
    };
    let start = data.len().saturating_sub(200 * 1024);
    Ok(String::from_utf8_lossy(&data[start..]).to_string())
}

/// `which`: game | kmod | mods | logs
#[tauri::command]
pub fn open_path(app: AppHandle, which: String) -> Result<(), String> {
    let base = win64(&app)?;
    let p = match which.as_str() {
        "game" => base,
        "kmod" => kmod_dir(&base),
        "mods" => kmod_dir(&base).join("mods"),
        "paks" => paks::paks_dir(&base).ok_or("找不到 Paks 文件夹")?,
        "logs" => kmod_dir(&base).join("logs"),
        _ => return Err("未知目录".into()),
    };
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer")
        .arg(&p)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/CCB-TEAM/") {
        return Err("不允许打开这个链接".into());
    }
    std::process::Command::new("explorer")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
