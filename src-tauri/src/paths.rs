//! Where the loader's folders are, per platform.

use crate::config;
use std::path::PathBuf;
use tauri::AppHandle;

pub struct Dirs {
    /// The `kmod` data folder (mods, state.json, logs, ...).
    pub kmod: PathBuf,
    /// Folder that holds pak mods.
    pub paks: PathBuf,
    /// Windows: the `Binaries\Win64` folder.
    pub game: Option<PathBuf>,
}

#[cfg(not(target_os = "android"))]
pub fn dirs(app: &AppHandle) -> Result<Dirs, String> {
    let cfg = config::load(app);
    let win64 = crate::game::normalize(&cfg.game_dir).ok_or_else(|| "还没有选择游戏目录".to_string())?;
    let paks = crate::paks::windows_paks_dir(&win64).ok_or("找不到 Paks 文件夹")?;
    Ok(Dirs { kmod: crate::game::kmod_dir(&win64), paks, game: Some(win64) })
}

/// Android: the loader keeps everything in the game's `Android/media` folder (see the loader's docs).
#[cfg(target_os = "android")]
pub fn dirs(app: &AppHandle) -> Result<Dirs, String> {
    let cfg = config::load(app);
    let pkg = if cfg.package.trim().is_empty() { config::DEFAULT_PACKAGE } else { cfg.package.trim() };
    let kmod = PathBuf::from("/sdcard/Android/media").join(pkg).join("kmod");
    Ok(Dirs { paks: kmod.join("paks"), kmod, game: None })
}
