//! Updating the launcher itself from its GitHub releases.
//!
//! The new file is only installed when it matches the SHA-256 that GitHub itself reported: if the release list could only be
//! fetched through the download proxy, the proxy could have made up both, so the player is sent to the release page instead.
//! (Android additionally refuses an APK signed with another key.)

use crate::config::Config;
use crate::{install, net};
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

const REPO: &str = "CCB-TEAM/KMod-Launcher";

#[cfg(target_os = "android")]
const ASSET_END: &str = "-android-arm64.apk";
#[cfg(not(target_os = "android"))]
const ASSET_END: &str = "-windows-x64.exe";

#[derive(Serialize, Clone, Debug)]
pub struct Update {
    pub version: String,
    pub notes: String,
    /// The release page.
    pub page: String,
    pub size: u64,
    /// The launcher can install it itself (see the module comment); otherwise only the page is offered.
    pub installable: bool,
    #[serde(skip)]
    url: String,
    #[serde(skip)]
    sha256: String,
}

/// "v1.2.0" -> [1, 2, 0]
fn numbers(v: &str) -> [u64; 3] {
    let mut parts = v.trim().trim_start_matches('v').split('.').map(|p| p.parse().unwrap_or(0));
    [parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0)]
}

/// The newest release after `current` that has a file for this platform. `direct`: the list came from GitHub itself.
fn newest(releases: &Value, current: &str, direct: bool) -> Option<Update> {
    releases
        .as_array()?
        .iter()
        .filter(|r| !r["draft"].as_bool().unwrap_or(false) && !r["prerelease"].as_bool().unwrap_or(false))
        .filter_map(|r| {
            let tag = r["tag_name"].as_str()?;
            if numbers(tag) <= numbers(current) {
                return None;
            }
            let asset = r["assets"].as_array()?.iter().find(|a| a["name"].as_str().is_some_and(|n| n.ends_with(ASSET_END)))?;
            let url = asset["browser_download_url"].as_str()?;
            if !url.starts_with(&format!("https://github.com/{REPO}/releases/download/")) {
                return None;
            }
            let sha256 = asset["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")).unwrap_or("").to_string();
            Some(Update {
                version: tag.trim_start_matches('v').to_string(),
                notes: r["body"].as_str().unwrap_or("").to_string(),
                page: format!("https://github.com/{REPO}/releases/tag/{tag}"),
                size: asset["size"].as_u64().unwrap_or(0),
                installable: direct && sha256.len() == 64,
                url: url.to_string(),
                sha256,
            })
        })
        .max_by_key(|u| numbers(&u.version))
}

pub fn check(cfg: &Config) -> Result<Option<Update>, String> {
    let url = format!("https://api.github.com/repos/{REPO}/releases?per_page=10");
    let get = |url: &str| -> Result<Value, String> {
        net::agent(cfg)
            .get(url)
            .set("Accept", "application/vnd.github+json")
            .call()
            .map_err(|e| e.to_string())?
            .into_json()
            .map_err(|e| e.to_string())
    };
    let (releases, direct) = match get(&url) {
        Ok(v) => (v, true),
        Err(first) => {
            let through = net::mirrored(cfg, &url);
            if through == url {
                return Err(format!("检查更新失败：{first}"));
            }
            (get(&through).map_err(|e| format!("检查更新失败。直连：{first}；代理：{e}"))?, false)
        }
    };
    Ok(newest(&releases, env!("CARGO_PKG_VERSION"), direct))
}

/// Downloads the update and checks it. Android: returns the APK, to be handed to the system installer.
/// Windows: puts the new program in place of the running one and returns its path.
pub fn fetch(app: &AppHandle, cfg: &Config) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let update = check(cfg)?.ok_or("已经是最新版本")?;
    if !update.installable {
        return Err("没能从 GitHub 直接取得校验值，请到发布页手动下载".into());
    }
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("update");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("KMod-Launcher-{}{ASSET_END}", update.version));
    let (file, sha) = install::download(app, cfg, &update.url, update.size, file)?;
    if !sha.eq_ignore_ascii_case(&update.sha256) {
        let _ = std::fs::remove_file(&file);
        return Err("下载的文件校验不一致（SHA-256），已丢弃。换一条下载线路再试。".into());
    }
    if cfg!(target_os = "android") {
        return Ok(file);
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    replace(&exe, &file)?;
    Ok(exe)
}

fn old_name(exe: &std::path::Path) -> std::path::PathBuf {
    let mut name = exe.as_os_str().to_owned();
    name.push(".old");
    name.into()
}

/// A running program cannot be overwritten on Windows, but it can be renamed.
fn replace(exe: &std::path::Path, new: &std::path::Path) -> Result<(), String> {
    let old = old_name(exe);
    let _ = std::fs::remove_file(&old);
    std::fs::rename(exe, &old).map_err(|e| format!("无法替换 {}（目录没有写入权限？）：{e}", exe.display()))?;
    if let Err(e) = std::fs::copy(new, exe) {
        let _ = std::fs::remove_file(exe);
        std::fs::rename(&old, exe).map_err(|back| format!("写入新版本失败：{e}；旧版本在 {}：{back}", old.display()))?;
        return Err(format!("写入新版本失败：{e}"));
    }
    Ok(())
}

/// Removes what the previous update left behind (the old program may still be closing: a later start gets it).
pub fn clean_up() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(old_name(&exe));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn picks_the_newest_release_for_this_platform() {
        let hash = "a".repeat(64);
        let rel = |tag: &str, pre: bool, name: &str| {
            json!({"tag_name": tag, "prerelease": pre, "body": "n", "assets": [{"name": name, "size": 1, "digest": format!("sha256:{hash}"),
                   "browser_download_url": format!("https://github.com/{REPO}/releases/download/{tag}/{name}")}]})
        };
        let name = format!("x{ASSET_END}");
        let all = json!([rel("v1.3.0", true, &name), rel("v1.10.0", false, &name), rel("v1.9.0", false, &name), rel("v2.0.0", false, "other.zip")]);
        let u = newest(&all, "1.2.0", true).unwrap();
        assert_eq!(u.version, "1.10.0");
        assert!(u.installable);
        assert!(!newest(&all, "1.2.0", false).unwrap().installable);
        assert!(newest(&all, "1.10.0", true).is_none());
    }

    #[test]
    fn the_program_is_swapped_and_kept_until_the_next_start() {
        let dir = std::env::temp_dir().join(format!("kmod-update-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (exe, new) = (dir.join("app.exe"), dir.join("new"));
        std::fs::write(&exe, b"old").unwrap();
        std::fs::write(&new, b"new").unwrap();
        replace(&exe, &new).unwrap();
        assert_eq!(std::fs::read(&exe).unwrap(), b"new");
        assert_eq!(std::fs::read(old_name(&exe)).unwrap(), b"old");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
