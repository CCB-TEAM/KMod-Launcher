use crate::config::Config;
use std::time::Duration;

pub const REPO: &str = "CCB-TEAM/KMod-Loader-Windows";

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

/// Applies the optional mirror ("GitHub proxy") prefix to a GitHub URL; other addresses are left alone.
pub fn mirrored(cfg: &Config, url: &str) -> String {
    let m = cfg.mirror.trim();
    let github = ["https://github.com/", "https://api.github.com/", "https://raw.githubusercontent.com/", "https://objects.githubusercontent.com/"];
    if m.is_empty() || !github.iter().any(|p| url.starts_with(p)) {
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
    /// "sha256:<hex>" as GitHub reports it (empty for old releases): the download is checked against it
    pub digest: String,
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
    // GitHub itself first (its checksums can be trusted most); the proxy only when that fails
    let get = |url: &str| -> Result<serde_json::Value, String> {
        agent(cfg)
            .get(url)
            .set("Accept", "application/vnd.github+json")
            .call()
            .map_err(|e| e.to_string())?
            .into_json()
            .map_err(|e| e.to_string())
    };
    let v = match get(&url) {
        Ok(v) => v,
        Err(direct) => {
            let through = mirrored(cfg, &url);
            if through == url {
                return Err(format!("无法获取版本列表：{direct}。可以试试切换下载线路。"));
            }
            get(&through).map_err(|e| format!("无法获取版本列表。直连：{direct}；代理：{e}"))?
        }
    };
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
                    digest: a["digest"].as_str().unwrap_or("").to_string(),
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
