use std::path::{Path, PathBuf};

pub const EXE: &str = "kards-Win64-Shipping.exe";

fn is_win64(p: &Path) -> bool {
    p.join(EXE).is_file()
}

/// Accepts the game root, the `kards` folder, `Binaries\Win64`, or the exe itself
/// and returns the `Binaries\Win64` folder if it holds the game.
pub fn normalize(input: &str) -> Option<PathBuf> {
    let mut p = PathBuf::from(input.trim().trim_matches('"'));
    if p.is_file() {
        p = p.parent()?.to_path_buf();
    }
    let candidates = [
        p.clone(),
        p.join("kards").join("Binaries").join("Win64"),
        p.join("Binaries").join("Win64"),
    ];
    candidates.into_iter().find(|c| is_win64(c))
}

#[cfg(windows)]
fn steam_roots() -> Vec<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;
    let mut out = Vec::new();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(k) = hkcu.open_subkey("Software\\Valve\\Steam") {
        if let Ok(v) = k.get_value::<String, _>("SteamPath") {
            out.push(PathBuf::from(v));
        }
    }
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(k) = hklm.open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam") {
        if let Ok(v) = k.get_value::<String, _>("InstallPath") {
            out.push(PathBuf::from(v));
        }
    }
    out
}

#[cfg(not(windows))]
fn steam_roots() -> Vec<PathBuf> {
    Vec::new()
}

/// Steam library folders, read from `steamapps\libraryfolders.vdf` (`"path"  "D:\\Games"` lines).
fn steam_libraries() -> Vec<PathBuf> {
    let mut libs = Vec::new();
    for root in steam_roots() {
        libs.push(root.clone());
        let vdf = root.join("steamapps").join("libraryfolders.vdf");
        if let Ok(text) = std::fs::read_to_string(vdf) {
            for line in text.lines() {
                let parts: Vec<&str> = line.split('"').collect();
                // ["\t\t", "path", "\t\t", "D:\\\\Games", ""]
                if parts.len() >= 4 && parts[1] == "path" {
                    libs.push(PathBuf::from(parts[3].replace("\\\\", "\\")));
                }
            }
        }
    }
    libs
}

/// Looks for KARDS in every Steam library.
pub fn detect() -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for lib in steam_libraries() {
        let common = lib.join("steamapps").join("common");
        let Ok(rd) = std::fs::read_dir(&common) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if !name.contains("kards") {
                continue;
            }
            if let Some(w) = normalize(&e.path().to_string_lossy()) {
                let s = w.to_string_lossy().to_string();
                if !found.contains(&s) {
                    found.push(s);
                }
            }
        }
    }
    found
}

pub fn kmod_dir(win64: &Path) -> PathBuf {
    win64.join("kmod")
}
