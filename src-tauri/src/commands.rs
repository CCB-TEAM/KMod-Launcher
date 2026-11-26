use crate::config::{self, Config};
use crate::game::{self, EXE};
use crate::install::{self, InstallState};
use crate::mods::{self, ModInfo};
use crate::net::{self, Release};
use crate::{android, pakmods, paks, paths, selfupdate, store};
use tauri::AppHandle;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// "windows" or "android": the frontend lays itself out and hides features by this.
#[tauri::command]
pub fn platform() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else {
        "windows"
    }
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
    // The icon is only changed through set_icon / reset_icon (the UI may hold a stale copy).
    config.icon = config::load(&app).icon;
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
    if cfg!(target_os = "android") {
        return false;
    }
    let mut cmd = std::process::Command::new("tasklist");
    cmd.args(["/FI", &format!("IMAGENAME eq {EXE}"), "/NH"]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains(&EXE.to_lowercase()))
        .unwrap_or(false)
}

fn package(app: &AppHandle) -> String {
    let p = config::load(app).package;
    if p.trim().is_empty() { config::DEFAULT_PACKAGE.into() } else { p.trim().to_string() }
}

#[tauri::command]
pub fn launch_game(app: AppHandle) -> Result<(), String> {
    if cfg!(target_os = "android") {
        return android::launch(&app, &package(&app));
    }
    let dir = paths::dirs(&app)?.game.ok_or("还没有选择游戏目录")?;
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
    let d = paths::dirs(&app)?;
    match &d.game {
        Some(win64) => Ok(install::state(win64)),
        // Android: the loader lives inside the patched game; its folder appears after the first start.
        None => Ok(InstallState {
            installed: d.kmod.join("state.json").is_file() || d.kmod.join("logs").is_dir(),
            tag: String::new(),
            flavor: String::new(),
            log_version: install::log_version(&d.kmod),
            foreign_proxy: false,
        }),
    }
}

#[tauri::command]
pub async fn android_info(app: AppHandle) -> Result<android::AndroidInfo, String> {
    let pkg = package(&app);
    blocking(move || android::info(&app, &pkg)).await
}

#[tauri::command]
pub async fn android_request_access(app: AppHandle) -> Result<(), String> {
    blocking(move || android::request_access(&app)).await
}

#[tauri::command]
pub async fn android_request_apps(app: AppHandle) -> Result<(), String> {
    blocking(move || android::request_apps(&app)).await
}

/// System file picker (Android). Returns paths of copies in the app cache.
#[tauri::command]
pub async fn android_pick(app: AppHandle, exts: Vec<String>) -> Result<Vec<String>, String> {
    blocking(move || android::pick(&app, &exts)).await
}

/// The built-in kmod installer (Android). Only these commands may be called.
#[tauri::command]
pub async fn android_installer(app: AppHandle, cmd: String, args: serde_json::Value) -> Result<serde_json::Value, String> {
    const ALLOWED: [&str; 9] = [
        "installerInfo",
        "installerAllowInstall",
        "installerScan",
        "installerInspect",
        "installerStart",
        "installerStatus",
        "installerUninstall",
        "installerProceed",
        "installerReset",
    ];
    if !ALLOWED.contains(&cmd.as_str()) {
        return Err("未知的安装器命令".into());
    }
    blocking(move || android::installer(&app, &cmd, args)).await
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<selfupdate::Update>, String> {
    let cfg = config::load(&app);
    blocking(move || selfupdate::check(&cfg)).await
}

/// Windows: replaces this program and restarts it. Android: opens the system installer with the new APK.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let cfg = config::load(&app);
    let handle = app.clone();
    let file = blocking(move || selfupdate::fetch(&handle, &cfg)).await?;
    if cfg!(target_os = "android") {
        return android::install_apk(&app, &file.to_string_lossy());
    }
    std::process::Command::new(&file).spawn().map_err(|e| format!("新版本已装好，但没能启动它：{e}"))?;
    app.exit(0);
    Ok(())
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
    digest: String,
    replace_foreign: bool,
) -> Result<(), String> {
    let cfg = config::load(&app);
    // Only ever download from the loader's own GitHub releases.
    let prefix = format!("https://github.com/{}/releases/download/", net::REPO);
    if !url.starts_with(&prefix) {
        return Err("下载地址不是官方发布页".into());
    }
    let dir = paths::dirs(&app)?.game.ok_or("还没有选择游戏目录")?;
    if game_running() {
        return Err("游戏正在运行，请先关闭游戏".into());
    }
    blocking(move || install::install(&app, &cfg, &dir, &url, size, &digest, &tag, &flavor, replace_foreign)).await
}

#[tauri::command]
pub fn uninstall_loader(app: AppHandle, remove_data: bool) -> Result<(), String> {
    let dir = paths::dirs(&app)?.game.ok_or("手机版请在系统里卸载打过补丁的游戏")?;
    if game_running() {
        return Err("游戏正在运行，请先关闭游戏".into());
    }
    install::uninstall(&dir, remove_data)
}

#[tauri::command]
pub fn list_mods(app: AppHandle) -> Result<Vec<ModInfo>, String> {
    let d = paths::dirs(&app)?;
    let mut all = mods::list(&d.kmod);
    let mut owned = pakmods::installed(&d.kmod, &d.paks);
    for m in &mut all {
        m.paks = owned.remove(&m.id).unwrap_or_default();
    }
    let mut paks = paks::list(&d.paks);
    // say which mod a pak came from
    for p in &mut paks {
        let file = format!("{}.pak", p.name);         // the original name, also for a pak renamed for the load order
        if let Some(owner) = all.iter().find(|m| m.paks.contains(&file)) {
            p.description = format!("{} · 来自 {}", p.description, owner.name);
        }
    }
    all.extend(paks);
    Ok(all)
}

#[tauri::command]
pub fn set_mod_enabled(app: AppHandle, id: String, enabled: bool, kind: String) -> Result<(), String> {
    let d = paths::dirs(&app)?;
    if kind == "pak" {
        if game_running() {
            return Err("游戏正在运行，请先关闭游戏".into());
        }
        return paks::set_enabled(&d.paks, &id, enabled);
    }
    mods::set_enabled(&d.kmod, &id, enabled)
}

#[tauri::command]
pub async fn install_mod(app: AppHandle, source: String, allow_native: bool, allow_paks: bool) -> Result<String, String> {
    let d = paths::dirs(&app)?;
    let opts = mods::Opts { paks: d.paks.clone(), allow_native, allow_paks, game_running: game_running() };
    let src = source.clone();
    // large pak packages take a while to check and unpack
    let r = blocking(move || {
        if src.to_lowercase().ends_with(".pak") {
            paks::install(&opts.paks, &src)
        } else {
            mods::install(&d.kmod, &src, &opts)
        }
    })
    .await;
    // Files the Android picker copied into the cache are ours to clean up (kept while the player is being asked).
    let asking = r.as_ref().err().is_some_and(|e| e == "NATIVE_CONFIRM" || e.starts_with("PAK_CONFIRM:"));
    if cfg!(target_os = "android") && !asking {
        let _ = std::fs::remove_file(&source);
    }
    r
}

#[tauri::command]
pub async fn fetch_catalog(app: AppHandle) -> Result<store::Catalog, String> {
    let cfg = config::load(&app);
    blocking(move || Ok(store::fetch(&cfg))).await
}

#[tauri::command]
pub async fn install_remote(app: AppHandle, id: String, url: String, sha256: String, size: u64, allow_native: bool, allow_paks: bool) -> Result<String, String> {
    let cfg = config::load(&app);
    let d = paths::dirs(&app)?;
    let opts = mods::Opts { paks: d.paks.clone(), allow_native, allow_paks, game_running: game_running() };
    blocking(move || store::install(&app, &cfg, &d.kmod, store::Wanted { id: &id, url: &url, sha256: &sha256, size }, &opts)).await
}

#[tauri::command]
pub fn delete_mod(app: AppHandle, file: String, id: String, kind: String, pending: bool, delete_paks: bool) -> Result<(), String> {
    let d = paths::dirs(&app)?;
    if kind == "pak" {
        if game_running() {
            return Err("游戏正在运行，请先关闭游戏".into());
        }
        return paks::delete(&d.paks, &file);
    }
    if delete_paks && game_running() {
        return Err("游戏正在运行，请先关闭游戏".into());
    }
    if mods::valid_id(&id) {
        pakmods::forget(&d.kmod, &d.paks, &id, delete_paks)?;
    }
    mods::delete(&d.kmod, &file, &id, pending)
}

/// Pak files (`X.pak`) in the order the loader mounts them; the last one wins.
#[tauri::command]
pub fn pak_order(app: AppHandle) -> Result<Vec<String>, String> {
    let d = paths::dirs(&app)?;
    Ok(paks::order(&d.kmod, &d.paks))
}

#[tauri::command]
pub fn set_pak_order(app: AppHandle, names: Vec<String>) -> Result<(), String> {
    let d = paths::dirs(&app)?;
    if !cfg!(target_os = "android") && game_running() {
        return Err("游戏正在运行，请先关闭游戏".into());
    }
    paks::set_order(&d.kmod, &d.paks, &names)
}

/// Last part of the loader log (about 200 KB).
#[tauri::command]
pub fn read_log(app: AppHandle, name: String) -> Result<String, String> {
    let d = paths::dirs(&app)?;
    let file = match name.as_str() {
        "proxy" => d.kmod.join("proxy.log"),
        _ => d.kmod.join("logs").join("kmod.log"),
    };
    let data = match std::fs::read(&file) {
        Ok(d) => d,
        Err(_) => return Ok(String::new()),
    };
    let start = data.len().saturating_sub(200 * 1024);
    Ok(String::from_utf8_lossy(&data[start..]).to_string())
}

/// `which`: game | kmod | mods | paks | logs (desktop only)
#[tauri::command]
pub fn open_path(app: AppHandle, which: String) -> Result<(), String> {
    if cfg!(target_os = "android") {
        return Err("手机上请用文件管理器打开 Android/media 里的 kmod 文件夹".into());
    }
    let d = paths::dirs(&app)?;
    let p = match which.as_str() {
        "game" => d.game.ok_or("还没有选择游戏目录")?,
        "kmod" => d.kmod,
        "mods" => d.kmod.join("mods"),
        "paks" => d.paks,
        "logs" => d.kmod.join("logs"),
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
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/") {
        return Err("不允许打开这个链接".into());
    }
    if cfg!(target_os = "android") {
        return android::open_url(&app, &url);
    }
    std::process::Command::new("explorer")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_icon(app: AppHandle) -> Option<String> {
    crate::icon::data_url(&app)
}

#[tauri::command]
pub fn set_icon(app: AppHandle, source: String) -> Result<(), String> {
    crate::icon::set(&app, &source)
}

#[tauri::command]
pub fn reset_icon(app: AppHandle) -> Result<(), String> {
    crate::icon::reset(&app)
}
