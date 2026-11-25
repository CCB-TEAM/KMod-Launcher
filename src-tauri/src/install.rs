use crate::config::Config;
use crate::game::kmod_dir;
use crate::net;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

const PROXY_DLL: &str = "dwmapi.dll";
const CORE_DLL: &str = "kmod_core.dll";
const MARKER: &str = "launcher.json";

/// What the launcher recorded when it installed the loader.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Installed {
    pub tag: String,
    pub flavor: String,
    pub sha256: String,
    pub installed_at: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct InstallState {
    /// kmod_core.dll and dwmapi.dll are both present.
    pub installed: bool,
    pub tag: String,
    pub flavor: String,
    /// Version read from the loader's own log, if the game ran at least once.
    pub log_version: String,
    /// A dwmapi.dll that is not the loader's (another injector such as UE4SS).
    pub foreign_proxy: bool,
}

#[derive(Serialize, Clone)]
struct Progress {
    stage: &'static str,
    done: u64,
    total: u64,
}

fn emit(app: &AppHandle, stage: &'static str, done: u64, total: u64) {
    let _ = app.emit("install-progress", Progress { stage, done, total });
}

fn read_marker(win64: &Path) -> Option<Installed> {
    let s = std::fs::read_to_string(kmod_dir(win64).join(MARKER)).ok()?;
    serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()
}

fn log_version(win64: &Path) -> String {
    // First line of kmod.log: "=== kmod loader 0.3.0 (release, Windows) started ==="
    let Ok(s) = std::fs::read_to_string(kmod_dir(win64).join("logs").join("kmod.log")) else {
        return String::new();
    };
    let line = s.lines().find(|l| l.contains("kmod loader")).unwrap_or("");
    line.split("kmod loader")
        .nth(1)
        .map(|r| r.trim().trim_end_matches('=').trim().trim_end_matches("started").trim().to_string())
        .unwrap_or_default()
}

pub fn state(win64: &Path) -> InstallState {
    let proxy = win64.join(PROXY_DLL).is_file();
    let core = kmod_dir(win64).join(CORE_DLL).is_file();
    let m = read_marker(win64).unwrap_or_default();
    InstallState {
        installed: proxy && core,
        tag: m.tag,
        flavor: m.flavor,
        log_version: log_version(win64),
        foreign_proxy: proxy && !core,
    }
}

fn io_msg(e: std::io::Error, what: &Path) -> String {
    if e.raw_os_error() == Some(32) || e.kind() == std::io::ErrorKind::PermissionDenied {
        format!("写入 {} 失败：文件被占用，请先关闭游戏", what.display())
    } else {
        format!("写入 {} 失败：{e}", what.display())
    }
}

fn download(app: &AppHandle, cfg: &Config, url: &str, size_hint: u64) -> Result<(PathBuf, String), String> {
    let tmp = std::env::temp_dir().join(format!("kmod-launcher-{}.zip", std::process::id()));
    let resp = net::agent(cfg)
        .get(&net::mirrored(cfg, url))
        .call()
        .map_err(|e| format!("下载失败：{e}"))?;
    let total = resp
        .header("Content-Length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(size_hint);
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut done = 0u64;
    let mut last = 0u64;
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("下载中断：{e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if done - last >= 128 * 1024 {
            last = done;
            emit(app, "download", done, total);
        }
    }
    emit(app, "download", done, done.max(total));
    if size_hint > 0 && done != size_hint {
        return Err(format!("下载不完整：收到 {done} 字节，应为 {size_hint}"));
    }
    let hex: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    Ok((tmp, hex))
}

/// Entries the archive may write: the proxy dll and anything under `kmod/`.
fn target_of(name: &str) -> Option<PathBuf> {
    let norm = name.replace('\\', "/");
    if norm == PROXY_DLL {
        return Some(PathBuf::from(PROXY_DLL));
    }
    let rest = norm.strip_prefix("kmod/")?;
    if rest.is_empty() || rest.ends_with('/') {
        return None;
    }
    let p = PathBuf::from("kmod").join(rest);
    // reject anything that is not a plain relative path
    if p.components().any(|c| !matches!(c, std::path::Component::Normal(_) | std::path::Component::CurDir)) {
        return None;
    }
    Some(p)
}

pub fn install(
    app: &AppHandle,
    cfg: &Config,
    win64: &Path,
    url: &str,
    size: u64,
    tag: &str,
    flavor: &str,
    replace_foreign: bool,
) -> Result<(), String> {
    let st = state(win64);
    if st.foreign_proxy {
        if !replace_foreign {
            return Err("FOREIGN_PROXY".into());
        }
    }
    emit(app, "download", 0, size);
    let (zip_path, sha) = download(app, cfg, url, size)?;
    let result = (|| {
        emit(app, "extract", 0, 0);
        let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("压缩包损坏：{e}"))?;
        // Check the archive really is a loader before touching the game folder.
        let has_core = (0..zip.len()).any(|i| {
            zip.by_index(i)
                .ok()
                .and_then(|f| target_of(f.name()))
                .map(|p| p.ends_with(CORE_DLL))
                .unwrap_or(false)
        });
        if !has_core {
            return Err("压缩包里没有 kmod_core.dll，不是 KMod 加载器".into());
        }
        if st.foreign_proxy {
            let old = win64.join(PROXY_DLL);
            let kept = win64.join("dwmapi.dll.disabled");
            let _ = std::fs::remove_file(&kept);
            std::fs::rename(&old, &kept).map_err(|e| io_msg(e, &old))?;
        }
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
            let Some(rel) = target_of(f.name()) else { continue };
            let dest = win64.join(&rel);
            if let Some(dir) = dest.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            // Never overwrite user data that ships empty in the archive.
            let mut data = Vec::new();
            f.read_to_end(&mut data).map_err(|e| e.to_string())?;
            std::fs::write(&dest, data).map_err(|e| io_msg(e, &dest))?;
        }
        let marker = Installed {
            tag: tag.to_string(),
            flavor: flavor.to_string(),
            sha256: sha.clone(),
            installed_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        };
        let text = serde_json::to_string_pretty(&marker).map_err(|e| e.to_string())?;
        std::fs::write(kmod_dir(win64).join(MARKER), text).map_err(|e| e.to_string())?;
        // New binaries: a leftover crash-protection state would only confuse the next start.
        let _ = std::fs::remove_file(kmod_dir(win64).join("boot").join("state.txt"));
        emit(app, "done", 0, 0);
        Ok(())
    })();
    let _ = std::fs::remove_file(&zip_path);
    result
}

pub fn uninstall(win64: &Path, remove_data: bool) -> Result<(), String> {
    let proxy = win64.join(PROXY_DLL);
    let core = kmod_dir(win64).join(CORE_DLL);
    if core.is_file() || read_marker(win64).is_some() {
        if proxy.is_file() {
            std::fs::remove_file(&proxy).map_err(|e| io_msg(e, &proxy))?;
        }
        // Put back the proxy we moved aside on install.
        let kept = win64.join("dwmapi.dll.disabled");
        if kept.is_file() && !proxy.exists() {
            let _ = std::fs::rename(&kept, &proxy);
        }
    }
    if remove_data {
        let d = kmod_dir(win64);
        if d.is_dir() {
            std::fs::remove_dir_all(&d).map_err(|e| io_msg(e, &d))?;
        }
    } else {
        for f in [core, kmod_dir(win64).join(MARKER)] {
            if f.is_file() {
                std::fs::remove_file(&f).map_err(|e| io_msg(e, &f))?;
            }
        }
    }
    Ok(())
}
