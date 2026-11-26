//! Pak mods: plain Unreal content paks in `kards\Content\Paks`. They are not loaded by the
//! KMod loader (the game mounts `*_P.pak` itself), so they work with or without it.
//! A pak is turned off by adding `.disable` to every file of the set (`X.pak`, `X.utoc`, `X.ucas`, `X.sig`).

use crate::mods::ModInfo;
use crate::pakname;
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
            name: pakname::logical_stem(&stem).to_string(),
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


/// Android: `kmod/pak-order.txt` decides the order the loader mounts kmod/paks in (one `.pak` name per line, a later line
/// wins). Paks it does not name come after the listed ones, by name.
fn order_file(kmod: &Path) -> PathBuf {
    kmod.join("pak-order.txt")
}

fn order_by_file(kmod: &Path, paks: &Path) -> Vec<String> {
    let mut names: Vec<String> = list(paks).into_iter().map(|m| format!("{}.pak", m.file)).collect();
    names.sort();
    let text = std::fs::read_to_string(order_file(kmod)).unwrap_or_default();
    let mut out = Vec::new();
    for line in text.trim_start_matches('\u{feff}').lines() {
        let n = line.trim_end();
        if let Some(i) = names.iter().position(|x| x == n) {
            out.push(names.remove(i));
        }
    }
    out.extend(names);
    out
}

/// Windows: the engine's own order, from the file names (equal priorities by name).
fn order_by_priority(paks: &Path) -> Vec<String> {
    let mut names: Vec<String> = list(paks).into_iter().map(|m| format!("{}.pak", m.file)).collect();
    names.sort_by(|a, b| pakname::priority(a).cmp(&pakname::priority(b)).then_with(|| a.to_lowercase().cmp(&b.to_lowercase())));
    names
}

/// Every pak (on or off) as its file name `X.pak`, in load order: the last one wins.
pub fn order(kmod: &Path, paks: &Path) -> Vec<String> {
    if cfg!(target_os = "android") {
        order_by_file(kmod, paks)
    } else {
        order_by_priority(paks)
    }
}

fn check_names(names: &[String]) -> Result<(), String> {
    if names.iter().any(|n| !n.to_lowercase().ends_with(".pak") || !valid_stem(n) || n.contains(['\n', '\r'])) {
        return Err("Pak 名字不合法".into());
    }
    Ok(())
}

fn set_order_file(kmod: &Path, names: &[String]) -> Result<(), String> {
    check_names(names)?;
    std::fs::create_dir_all(kmod).map_err(|e| e.to_string())?;
    let mut text = names.join("\n");
    text.push('\n');
    std::fs::write(order_file(kmod), text).map_err(|e| e.to_string())
}

/// Windows: renames every pak set so its name carries its place (`X_P.kmod_01_P.pak`, `…_02_P`, …; see pakname.rs).
fn set_order_by_names(paks: &Path, names: &[String]) -> Result<(), String> {
    check_names(names)?;
    for (i, name) in names.iter().enumerate() {
        let stem = &name[..name.len() - 4];
        if is_base_game(stem) {
            return Err("不能改游戏本体的 pak".into());
        }
        let want = pakname::tagged_stem(pakname::logical_stem(stem), i as u32 + 1);
        if want == stem {
            continue;
        }
        for on in [true, false] {
            for f in set_files(paks, stem, on) {
                let file = f.file_name().unwrap_or_default().to_string_lossy().to_string();
                let renamed = file.replacen(stem, &want, 1);
                let to = paks.join(&renamed);
                if to.exists() {
                    return Err(format!("{renamed} 已经存在"));
                }
                std::fs::rename(&f, &to).map_err(|e| {
                    if e.raw_os_error() == Some(32) || e.kind() == std::io::ErrorKind::PermissionDenied {
                        format!("{} 被占用，请先关闭游戏", f.display())
                    } else {
                        e.to_string()
                    }
                })?;
            }
        }
    }
    Ok(())
}

/// `names`: the pak files (`X.pak`, as `order` returns them) in the new order.
pub fn set_order(kmod: &Path, paks: &Path, names: &[String]) -> Result<(), String> {
    if cfg!(target_os = "android") {
        set_order_file(kmod, names)
    } else {
        set_order_by_names(paks, names)
    }
}

/// Copies a `.pak` and its `.utoc` / `.ucas` / `.sig` siblings into the Paks folder (enabled). A copy that was renamed for
/// the load order is replaced under its current name, so it keeps its place.
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
            let name = pakname::target(&dir, &format!("{stem}.{e}"));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn order_follows_the_file_then_names() {
        let root = std::env::temp_dir().join(format!("kmod-order-test-{}", std::process::id()));
        let paks = root.join("paks");
        std::fs::create_dir_all(&paks).unwrap();
        for f in ["b.pak", "中文_P.pak", "a.pak.disable", "c.pak"] {
            std::fs::write(paks.join(f), b"x").unwrap();
        }
        assert_eq!(order_by_file(&root, &paks), ["a.pak", "b.pak", "c.pak", "中文_P.pak"]);
        set_order_file(&root, &["中文_P.pak".into(), "gone.pak".into(), "a.pak".into()]).unwrap();
        assert_eq!(order_by_file(&root, &paks), ["中文_P.pak", "a.pak", "b.pak", "c.pak"]);
        assert!(set_order_file(&root, &["../x.pak".into()]).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn windows_order_by_renaming() {
        let paks = std::env::temp_dir().join(format!("kmod-order-win-{}", std::process::id()));
        std::fs::create_dir_all(&paks).unwrap();
        for f in ["B_P.pak", "B_P.utoc", "A_P.pak.disable", "C.pak", "kards-Windows.pak"] {
            std::fs::write(paks.join(f), b"x").unwrap();
        }
        assert_eq!(order_by_priority(&paks), ["C.pak", "A_P.pak", "B_P.pak"]);
        set_order_by_names(&paks, &["B_P.pak".into(), "C.pak".into(), "A_P.pak".into()]).unwrap();
        assert_eq!(order_by_priority(&paks), ["B_P.kmod_01_P.pak", "C.kmod_02_P.pak", "A_P.kmod_03_P.pak"]);
        assert!(paks.join("B_P.kmod_01_P.utoc").is_file() && paks.join("A_P.kmod_03_P.pak.disable").is_file());
        // shown under the original name; a new copy of a renamed pak keeps its place
        let shown: Vec<String> = list(&paks).into_iter().map(|m| m.name).collect();
        assert_eq!(shown, ["A_P", "B_P", "C"]);
        let src = paks.join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("B_P.pak"), b"new").unwrap();
        install(&paks, &src.join("B_P.pak").to_string_lossy()).unwrap();
        assert_eq!(std::fs::read(paks.join("B_P.kmod_01_P.pak")).unwrap(), b"new");
        assert!(!paks.join("B_P.pak").exists());
        set_order_by_names(&paks, &["A_P.kmod_03_P.pak".into(), "B_P.kmod_01_P.pak".into(), "C.kmod_02_P.pak".into()]).unwrap();
        assert_eq!(order_by_priority(&paks), ["A_P.kmod_01_P.pak", "B_P.kmod_02_P.pak", "C.kmod_03_P.pak"]);
        std::fs::remove_dir_all(&paks).unwrap();
    }
}