//! The online mod catalogue: reads one or more index.json files and installs packages from them.
use crate::config::Config;
use crate::{install, mods, net};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use tauri::AppHandle;

pub const DEFAULT_INDEX: &str = "https://raw.githubusercontent.com/CCB-TEAM/kmod-index/main/index.json";
const INDEX_LIMIT: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
pub struct Catalog {
    /// Mod entries as the index gives them, with absolute URLs; the first index that lists an id wins.
    pub mods: Vec<Value>,
    /// Ids any index has taken down.
    pub blocked: Vec<String>,
    /// One message per index that could not be read.
    pub errors: Vec<String>,
}

/// Downloads must be https; plain http only from this computer (testing a local index).
pub fn allowed_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost")
}

/// `rel` as written in an index, resolved against the index's own address.
fn resolve(base: &str, rel: &str) -> Option<String> {
    if rel.contains("://") {
        return allowed_url(rel).then(|| rel.to_string());
    }
    if rel.is_empty() || rel.starts_with('/') || rel.split('/').any(|p| p == "..") {
        return None;
    }
    let cut = base.rfind('/')?;
    Some(format!("{}/{}", &base[..cut], rel))
}

fn get_text(cfg: &Config, url: &str) -> Result<String, String> {
    let get = |u: &str| -> Result<String, String> {
        use std::io::Read;
        let mut s = String::new();
        net::agent(cfg)
            .get(u)
            .call()
            .map_err(|e| e.to_string())?
            .into_reader()
            .take(INDEX_LIMIT)
            .read_to_string(&mut s)
            .map_err(|e| e.to_string())?;
        Ok(s)
    };
    // directly first, through the GitHub proxy when that fails
    match get(url) {
        Ok(s) => Ok(s),
        Err(direct) => {
            let through = net::mirrored(cfg, url);
            if through == url {
                return Err(direct);
            }
            get(&through).map_err(|e| format!("直连：{direct}；代理：{e}"))
        }
    }
}

/// Merges one parsed index into the catalogue.
fn add(cat: &mut Catalog, cfg: &Config, source: &str, index: Value) -> Result<(), String> {
    if index["schema"].as_u64() != Some(1) {
        return Err("索引格式版本不认识，请更新启动器".into());
    }
    for id in index["blocked"].as_array().into_iter().flatten().filter_map(|v| v.as_str()) {
        cat.blocked.push(id.to_string());
    }
    for m in index["mods"].as_array().ok_or("索引里没有 mods")? {
        let Some(id) = m["id"].as_str().filter(|s| mods::valid_id(s)) else { continue };
        if cat.mods.iter().any(|x| x["id"] == id) {
            continue;
        }
        let mut m = m.clone();
        for key in ["icon", "cover"] {
            let url = m[key].as_str().and_then(|r| resolve(source, r)).map(|u| net::mirrored(cfg, &u));
            m[key] = url.map(Value::from).unwrap_or(Value::Null);
        }
        let versions: Vec<Value> = m["versions"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|mut v| {
                let url = v["url"].as_str().and_then(|r| resolve(source, r))?;
                // a version without a checksum cannot be installed
                v["sha256"].as_str().filter(|s| s.len() == 64)?;
                v["url"] = url.into();
                Some(v)
            })
            .collect();
        if versions.is_empty() {
            continue;
        }
        m["versions"] = versions.into();
        m["source"] = source.into();
        cat.mods.push(m);
    }
    Ok(())
}

pub fn fetch(cfg: &Config) -> Catalog {
    let mut cat = Catalog { mods: Vec::new(), blocked: Vec::new(), errors: Vec::new() };
    let mut urls: Vec<&str> = cfg.index_url.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if urls.is_empty() {
        urls.push(DEFAULT_INDEX);
    }
    for url in urls {
        let r = if allowed_url(url) {
            get_text(cfg, url).and_then(|s| serde_json::from_str::<Value>(s.trim_start_matches('\u{feff}')).map_err(|e| e.to_string()))
        } else {
            Err("索引地址必须是 https".into())
        };
        if let Err(e) = r.and_then(|v| add(&mut cat, cfg, url, v)) {
            cat.errors.push(format!("{url}：{e}"));
        }
    }
    let blocked = cat.blocked.clone();
    cat.mods.retain(|m| !blocked.iter().any(|b| m["id"] == b.as_str()));
    cat
}

/// What the catalogue says about the package to install; the download has to match it.
pub struct Wanted<'a> {
    pub id: &'a str,
    pub url: &'a str,
    pub sha256: &'a str,
    pub size: u64,
}

/// Downloads a package, checks it against the catalogue and puts it into kmod/mods (replacing the installed mod of the same id).
/// Native mods and pak changes need the player's agreement first (see mods::install_package).
pub fn install(app: &AppHandle, cfg: &Config, kmod: &Path, w: Wanted, opts: &mods::Opts) -> Result<String, String> {
    if !mods::valid_id(w.id) || !allowed_url(w.url) {
        return Err("索引里的这个模组信息不合法".into());
    }
    let dir = std::env::temp_dir().join(format!("kmod-store-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{}.kmod", w.id));
    let result = (|| {
        let (path, sha) = install::download(app, cfg, w.url, w.size, tmp.clone())?;
        if !sha.eq_ignore_ascii_case(w.sha256) {
            return Err("下载的文件校验不一致（SHA-256），已丢弃。换一条下载线路再试。".into());
        }
        mods::install_package(kmod, &path, Some(w.id), opts)
    })();
    let _ = std::fs::remove_dir_all(&dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn index_urls_are_resolved_and_checked() {
        let mut cfg = Config::default();
        cfg.mirror = "https://gh-proxy.com".into();
        let mut cat = Catalog { mods: vec![], blocked: vec![], errors: vec![] };
        let base = "https://raw.githubusercontent.com/o/idx/main/index.json";
        let hash = "a".repeat(64);
        add(&mut cat, &cfg, base, json!({"schema":1,"mods":[
            {"id":"a","icon":"icons/a.png","versions":[{"url":"packages/a.kmod","sha256":hash}]},
            {"id":"bad id","versions":[{"url":"x.kmod","sha256":hash}]},
            {"id":"b","versions":[{"url":"http://evil/x.kmod","sha256":hash},{"url":"../x.kmod","sha256":hash},{"url":"x.kmod"}]}
        ]})).unwrap();
        assert_eq!(cat.mods.len(), 1);
        assert_eq!(cat.mods[0]["versions"][0]["url"], "https://raw.githubusercontent.com/o/idx/main/packages/a.kmod");
        assert_eq!(cat.mods[0]["icon"], "https://gh-proxy.com/https://raw.githubusercontent.com/o/idx/main/icons/a.png");
    }
}
