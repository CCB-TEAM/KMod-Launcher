use crate::config::Config;
use std::time::Duration;

#[cfg(not(target_os = "android"))]
pub const REPO: &str = "CCB-TEAM/KMod-Loader-Windows";
/// On Android the loader is injected into the game by the installer app, so that is what the launcher offers.
#[cfg(target_os = "android")]
pub const REPO: &str = "CCB-TEAM/KMod-Loader-Android";

pub fn agent(cfg: &Config) -> ureq::Agent {
    let mut b = ureq::AgentBuilder::new()
        .user_agent(concat!("KMod-Launcher/", env!("CARGO_PKG_VERSION")))
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(30));
    let proxy = cfg.proxy.trim();
    if !proxy.is_empty() {
        if let Ok(p) = ureq::Proxy::new(proxy) {
            b = b.proxy(p);
        }
    }
    b.build()
}

/// Applies the optional mirror prefix to a download URL.
pub fn mirrored(cfg: &Config, url: &str) -> String {
    let m = cfg.mirror.trim();
    if m.is_empty() {
        url.to_string()
    } else {
        format!("{}/{}", m.trim_end_matches('/'), url)
    }
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub size: u64,
    /// "release" or "dev"
    pub flavor: String,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct Release {
    pub tag: String,
    pub name: String,
    pub prerelease: bool,
    pub published: String,
    pub notes: String,
    pub assets: Vec<Asset>,
}

#[cfg(target_os = "android")]
fn flavor_of(name: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    if n.starts_with("kmod-installer") && n.ends_with(".apk") {
        Some("release")
    } else {
        None
    }
}

#[cfg(not(target_os = "android"))]
fn flavor_of(name: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    if !n.ends_with(".zip") {
        return None;
    }
    if n.ends_with("-dev.zip") {
        Some("dev")
    } else if n.ends_with("-release.zip") {
        Some("release")
    } else {
        None
    }
}

pub fn fetch_releases(cfg: &Config) -> Result<Vec<Release>, String> {
    let url = format!("https://api.github.com/repos/{REPO}/releases?per_page=30");
    let v: serde_json::Value = agent(cfg)
        .get(&url)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("无法获取版本列表：{e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in v.as_array().ok_or("版本列表格式不对")? {
        if r["draft"].as_bool().unwrap_or(false) {
            continue;
        }
        let prerelease = r["prerelease"].as_bool().unwrap_or(false);
        if prerelease && !cfg.prereleases {
            continue;
        }
        let mut assets = Vec::new();
        for a in r["assets"].as_array().cloned().unwrap_or_default() {
            let name = a["name"].as_str().unwrap_or("").to_string();
            if let (Some(f), Some(url)) = (flavor_of(&name), a["browser_download_url"].as_str()) {
                assets.push(Asset {
                    name,
                    url: url.to_string(),
                    size: a["size"].as_u64().unwrap_or(0),
                    flavor: f.to_string(),
                });
            }
        }
        if assets.is_empty() {
            continue;
        }
        out.push(Release {
            tag: r["tag_name"].as_str().unwrap_or("").to_string(),
            name: r["name"].as_str().unwrap_or("").to_string(),
            prerelease,
            published: r["published_at"].as_str().unwrap_or("").to_string(),
            notes: r["body"].as_str().unwrap_or("").to_string(),
            assets,
        });
    }
    Ok(out)
}
