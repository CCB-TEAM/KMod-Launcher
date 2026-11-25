use crate::game::kmod_dir;
use serde::Serialize;
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug)]
pub struct ModInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub enabled: bool,
    /// "folder" or "kmod"
    pub kind: String,
    /// File or folder name inside kmod\mods
    pub file: String,
}

fn mods_dir(win64: &Path) -> PathBuf {
    kmod_dir(win64).join("mods")
}

fn state_path(win64: &Path) -> PathBuf {
    kmod_dir(win64).join("state.json")
}

fn read_state(win64: &Path) -> Value {
    std::fs::read_to_string(state_path(win64))
        .ok()
        .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_else(|| json!({}))
}

fn enabled_ids(state: &Value) -> Vec<String> {
    state["enabled"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn parse_manifest(text: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    v["id"].as_str().filter(|s| !s.is_empty())?;
    Some(v)
}

fn manifest_of_kmod(path: &Path) -> Option<Value> {
    let f = std::fs::File::open(path).ok()?;
    let mut z = zip::ZipArchive::new(f).ok()?;
    let mut entry = z.by_name("mod.json").ok()?;
    let mut s = String::new();
    entry.read_to_string(&mut s).ok()?;
    parse_manifest(&s)
}

fn info(m: &Value, enabled: &[String], kind: &str, file: String) -> ModInfo {
    let id = m["id"].as_str().unwrap_or("").to_string();
    let s = |k: &str| m[k].as_str().unwrap_or("").to_string();
    ModInfo {
        enabled: enabled.contains(&id),
        name: if s("name").is_empty() { id.clone() } else { s("name") },
        version: s("version"),
        author: s("author"),
        description: s("description"),
        id,
        kind: kind.into(),
        file,
    }
}

pub fn list(win64: &Path) -> Vec<ModInfo> {
    let enabled = enabled_ids(&read_state(win64));
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(mods_dir(win64)) else { return out };
    for e in rd.flatten() {
        let p = e.path();
        let file = e.file_name().to_string_lossy().to_string();
        if p.is_dir() {
            if let Some(m) = std::fs::read_to_string(p.join("mod.json")).ok().and_then(|s| parse_manifest(&s)) {
                out.push(info(&m, &enabled, "folder", file));
            }
        } else if file.to_lowercase().ends_with(".kmod") {
            if let Some(m) = manifest_of_kmod(&p) {
                out.push(info(&m, &enabled, "kmod", file));
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
}

pub fn set_enabled(win64: &Path, id: &str, enabled: bool) -> Result<(), String> {
    if !valid_id(id) {
        return Err("模组 id 不合法".into());
    }
    let mut state = read_state(win64);
    let mut ids = enabled_ids(&state);
    ids.retain(|x| x != id);
    if enabled {
        ids.push(id.to_string());
    }
    state["enabled"] = json!(ids);
    let dir = kmod_dir(win64);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    std::fs::write(state_path(win64), text).map_err(|e| e.to_string())
}

/// Copies a `.kmod` file or a mod folder into kmod\mods. Returns the mod's name.
pub fn install(win64: &Path, source: &str) -> Result<String, String> {
    let src = PathBuf::from(source);
    let dir = mods_dir(win64);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if src.is_dir() {
        let m = std::fs::read_to_string(src.join("mod.json"))
            .ok()
            .and_then(|s| parse_manifest(&s))
            .ok_or("这个文件夹里没有有效的 mod.json")?;
        let name = src.file_name().ok_or("路径不对")?;
        copy_dir(&src, &dir.join(name))?;
        return Ok(m["name"].as_str().or(m["id"].as_str()).unwrap_or("").to_string());
    }
    let ext_ok = src.extension().map(|e| e.eq_ignore_ascii_case("kmod")).unwrap_or(false);
    if !ext_ok {
        return Err("只能安装 .kmod 文件或模组文件夹".into());
    }
    let m = manifest_of_kmod(&src).ok_or("这个文件不是有效的 .kmod（缺少 mod.json 或 id）")?;
    let name = src.file_name().ok_or("路径不对")?;
    std::fs::copy(&src, dir.join(name)).map_err(|e| e.to_string())?;
    Ok(m["name"].as_str().or(m["id"].as_str()).unwrap_or("").to_string())
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for e in std::fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let t = to.join(e.file_name());
        if e.path().is_dir() {
            copy_dir(&e.path(), &t)?;
        } else {
            std::fs::copy(e.path(), &t).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn delete(win64: &Path, file: &str, id: &str) -> Result<(), String> {
    // `file` comes from the UI: it must be a plain name inside kmod\mods.
    if file.is_empty() || file.contains(['/', '\\']) || file == "." || file == ".." {
        return Err("文件名不合法".into());
    }
    let p = mods_dir(win64).join(file);
    if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
    } else if p.is_file() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    if valid_id(id) {
        let private = kmod_dir(win64).join(".private").join("mods").join(id);
        let _ = std::fs::remove_dir_all(private);
        set_enabled(win64, id, false)?;
    }
    Ok(())
}
