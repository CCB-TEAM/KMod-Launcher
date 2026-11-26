//! Pak mods: plain Unreal content paks in `kards\Content\Paks`. They are not loaded by the
//! KMod loader (the game mounts `*_P.pak` itself), so they work with or without it.
//! A pak is turned off by adding `.disable` to every file of the set (`X.pak`, `X.utoc`, `X.ucas`, `X.sig`).

use crate::mods::ModInfo;
use std::path::{Path, PathBuf};

const EXTS: [&str; 4] = ["pak", "utoc", "ucas", "sig"];
const OFF: &str = ".disable";

/// Windows: `...\kards\Binaries\Win64` -> `...\kards\Content\Paks`
pub fn windows_paks_dir(win64: &Path) -> Option<PathBuf> {
    let kards = win64.parent()?.parent()?;
    Some(kards.join("Content").join("Paks"))
}

fn is_base_game(stem: &str) -> bool {
    stem.to_lowercase().starts_with("kards-windows")
}

fn valid_stem(s: &str) -> bool {
    !s.is_empty() && !s.contains(['/', '\\', ':']) && s != "." && s != ".."
}

fn set_files(dir: &Path, stem: &str, enabled_now: bool) -> Vec<PathBuf> {
    EXTS.iter()
        .map(|e| {
            let name = format!("{stem}.{e}");
            dir.join(if enabled_now { name } else { format!("{name}{OFF}") })
        })
        .filter(|p| p.is_file())
        .collect()
}

fn size_text(bytes: u64) -> String {
    if bytes >= 1 << 20 {
        format!("{:.1} MB", bytes as f64 / 1048576.0)
    } else {
        format!("{} KB", (bytes / 1024).max(1))
    }
}

pub fn list(paks: &Path) -> Vec<ModInfo> {
    let mut out = Vec::new();
    let dir = paks.to_path_buf();
    let Ok(rd) = std::fs::read_dir(&dir) else { return out };
    for e in rd.flatten() {
        if !e.path().is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        // suffixes are ASCII, so cutting by their length is safe for any file name
        let (cut, enabled) = if lower.ends_with(".pak") {
            (4, true)
        } else if lower.ends_with(&format!(".pak{OFF}")) {
            (4 + OFF.len(), false)
        } else {
            continue;
        };
        let stem = name[..name.len() - cut].to_string();
        if is_base_game(&stem) {
            continue;
        }
        let total: u64 = set_files(&dir, &stem, enabled)
            .iter()
            .filter_map(|p| p.metadata().ok())
            .map(|m| m.len())
            .sum();
        out.push(ModInfo {
            id: stem.clone(),
            name: stem.clone(),
            version: String::new(),
            author: String::new(),
            description: format!("Pak 模组 · {}", size_text(total)),
            enabled,
            kind: "pak".into(),
            pack: "pak".into(),
            file: stem,
            pending: false,
            icon: String::new(),
            paks: Vec::new(),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

fn rename_all(files: Vec<PathBuf>, to_disabled: bool) -> Result<(), String> {
    for f in files {
        let target = if to_disabled {
            PathBuf::from(format!("{}{OFF}", f.to_string_lossy()))
        } else {
            PathBuf::from(f.to_string_lossy().trim_end_matches(OFF))
        };
        let _ = std::fs::remove_file(&target);
        std::fs::rename(&f, &target).map_err(|e| {
            if e.raw_os_error() == Some(32) || e.kind() == std::io::ErrorKind::PermissionDenied {
                format!("{} 被占用，请先关闭游戏", f.display())
            } else {
                e.to_string()
            }
        })?;
    }
    Ok(())
}

pub fn set_enabled(paks: &Path, stem: &str, enabled: bool) -> Result<(), String> {
    if !valid_stem(stem) || is_base_game(stem) {
        return Err("Pak 名字不合法".into());
    }
    let dir = paks.to_path_buf();
    let files = set_files(&dir, stem, !enabled);
    if files.is_empty() {
        return Ok(());
    }
    rename_all(files, !enabled)
}

pub fn delete(paks: &Path, stem: &str) -> Result<(), String> {
    if !valid_stem(stem) || is_base_game(stem) {
        return Err("Pak 名字不合法".into());
    }
    let dir = paks.to_path_buf();
    for on in [true, false] {
        for f in set_files(&dir, stem, on) {
            std::fs::remove_file(&f).map_err(|e| format!("{}：{e}", f.display()))?;
        }
    }
    Ok(())
}

/// Copies a `.pak` and its `.utoc` / `.ucas` / `.sig` siblings into the Paks folder (enabled).
pub fn install(paks: &Path, source: &str) -> Result<String, String> {
    let src = PathBuf::from(source);
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| valid_stem(s))
        .ok_or("文件名不合法")?
        .to_string();
    if is_base_game(&stem) {
        return Err("不能覆盖游戏本体的 pak".into());
    }
    let dir = paks.to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let from = src.parent().ok_or("路径不对")?;
    let mut n = 0;
    for e in EXTS {
        let f = from.join(format!("{stem}.{e}"));
        if f.is_file() {
            let name = format!("{stem}.{e}");
            // a stale disabled copy would shadow the new one
            let _ = std::fs::remove_file(dir.join(format!("{name}{OFF}")));
            std::fs::copy(&f, dir.join(&name)).map_err(|e| e.to_string())?;
            n += 1;
        }
    }
    if n == 0 {
        return Err("没有找到这个 pak 文件".into());
    }
    Ok(stem)
}
