use crate::pakmods;
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
    /// "lua", "native" or "pak"
    pub kind: String,
    /// How it is packaged: "folder", "kmod" or "pak"
    pub pack: String,
    /// File or folder name inside kmod\mods
    pub file: String,
    /// Waiting in the inbox: the loader installs it on the next game start (Android).
    pub pending: bool,
    /// The package's icon as a data: URL, empty when it has none.
    pub icon: String,
    /// Pak files this mod installed that are still there.
    pub paks: Vec<String>,
}

/// What the player has agreed to for one installation, and where paks go.
pub struct Opts {
    pub paks: PathBuf,
    pub allow_native: bool,
    pub allow_paks: bool,
    pub game_running: bool,
}

/// Icons larger than this are ignored.
const ICON_LIMIT: u64 = 512 * 1024;

/// The icon's path inside the package: "icon" in mod.json, else icon.png. None when the manifest names something unusable.
fn icon_name(m: &Value) -> Option<String> {
    let name = m["icon"].as_str().filter(|s| !s.is_empty()).unwrap_or("icon.png").replace('\\', "/");
    let plain = Path::new(&name).components().all(|c| matches!(c, std::path::Component::Normal(_)));
    (plain && !name.contains(':') && icon_mime(&name).is_some()).then_some(name)
}

fn icon_mime(name: &str) -> Option<&'static str> {
    match name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn data_url(name: &str, bytes: &[u8]) -> String {
    use base64::Engine;
    let mime = icon_mime(name).unwrap_or("image/png");
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn icon_of_folder(dir: &Path, m: &Value) -> String {
    let Some(name) = icon_name(m) else { return String::new() };
    let p = dir.join(&name);
    match std::fs::metadata(&p) {
        Ok(md) if md.is_file() && md.len() <= ICON_LIMIT => std::fs::read(&p).map(|b| data_url(&name, &b)).unwrap_or_default(),
        _ => String::new(),
    }
}

fn icon_of_kmod(path: &Path, m: &Value) -> String {
    let Some(name) = icon_name(m) else { return String::new() };
    let read = || -> Option<Vec<u8>> {
        let mut z = zip::ZipArchive::new(std::fs::File::open(path).ok()?).ok()?;
        let entry = z.by_name(&name).ok()?;
        if entry.size() > ICON_LIMIT {
            return None;
        }
        let mut b = Vec::new();
        entry.take(ICON_LIMIT).read_to_end(&mut b).ok()?;
        Some(b)
    };
    read().map(|b| data_url(&name, &b)).unwrap_or_default()
}

fn mods_dir(kmod: &Path) -> PathBuf {
    kmod.join("mods")
}

fn state_path(kmod: &Path) -> PathBuf {
    kmod.join("state.json")
}

fn read_state(kmod: &Path) -> Value {
    std::fs::read_to_string(state_path(kmod))
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

#[cfg(target_os = "android")]
const PLATFORM_KEY: &str = "Android";
#[cfg(not(target_os = "android"))]
const PLATFORM_KEY: &str = "Windows";

/// A mod is native here when `native` is a string, or an object that has an entry for this platform.
fn is_native(m: &Value) -> bool {
    match &m["native"] {
        Value::String(s) => !s.is_empty(),
        Value::Object(o) => o.get(PLATFORM_KEY).and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false),
        _ => false,
    }
}

fn info(m: &Value, enabled: &[String], pack: &str, file: String) -> ModInfo {
    let id = m["id"].as_str().unwrap_or("").to_string();
    let s = |k: &str| m[k].as_str().unwrap_or("").to_string();
    ModInfo {
        enabled: enabled.contains(&id),
        name: if s("name").is_empty() { id.clone() } else { s("name") },
        version: s("version"),
        author: s("author"),
        description: s("description"),
        id,
        kind: if is_native(m) { "native" } else { "lua" }.into(),
        pack: pack.into(),
        file,
        pending: false,
        icon: String::new(),
        paks: Vec::new(),
    }
}

pub fn list(kmod: &Path) -> Vec<ModInfo> {
    let enabled = enabled_ids(&read_state(kmod));
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(mods_dir(kmod)) else { return out };
    for e in rd.flatten() {
        let p = e.path();
        let file = e.file_name().to_string_lossy().to_string();
        if p.is_dir() {
            if let Some(m) = std::fs::read_to_string(p.join("mod.json")).ok().and_then(|s| parse_manifest(&s)) {
                let mut i = info(&m, &enabled, "folder", file);
                i.icon = icon_of_folder(&p, &m);
                out.push(i);
            }
        } else if file.to_lowercase().ends_with(".kmod") {
            if let Some(m) = manifest_of_kmod(&p) {
                let mut i = info(&m, &enabled, "kmod", file);
                i.icon = icon_of_kmod(&p, &m);
                out.push(i);
            }
        }
    }
    // .kmod packages waiting in the inbox (Android installs them when the game starts)
    if let Ok(rd) = std::fs::read_dir(kmod.join("inbox")) {
        for e in rd.flatten() {
            let file = e.file_name().to_string_lossy().to_string();
            if !file.to_lowercase().ends_with(".kmod") {
                continue;
            }
            if let Some(m) = manifest_of_kmod(&e.path()) {
                let mut i = info(&m, &enabled, "kmod", file);
                i.pending = true;
                i.icon = icon_of_kmod(&e.path(), &m);
                out.push(i);
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
}

pub fn set_enabled(kmod: &Path, id: &str, enabled: bool) -> Result<(), String> {
    if !valid_id(id) {
        return Err("模组 id 不合法".into());
    }
    let mut state = read_state(kmod);
    let mut ids = enabled_ids(&state);
    ids.retain(|x| x != id);
    if enabled {
        ids.push(id.to_string());
    }
    state["enabled"] = json!(ids);
    let dir = kmod.to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    std::fs::write(state_path(kmod), text).map_err(|e| e.to_string())
}

/// Removes every installed copy of a mod (folder or package, also one still in the old inbox).
fn remove_copies(kmod: &Path, id: &str) -> Result<(), String> {
    for m in list(kmod).into_iter().filter(|m| m.id == id) {
        let base = if m.pending { kmod.join("inbox") } else { mods_dir(kmod) };
        let p = base.join(&m.file);
        let r = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
        r.map_err(|e| format!("删除旧版本 {} 失败：{e}", m.file))?;
    }
    Ok(())
}

/// Puts a `.kmod` package into kmod/mods as <id>.kmod, replacing any installed copy, installs its paks and enables it.
/// `expect` is the id the caller believes it installs. Native mods need `allow_native` (error NATIVE_CONFIRM otherwise);
/// overwriting or removing pak files needs `allow_paks` (error "PAK_CONFIRM:{plan}" otherwise).
pub fn install_package(kmod: &Path, src: &Path, expect: Option<&str>, opts: &Opts) -> Result<String, String> {
    let m = manifest_of_kmod(src).ok_or("这个文件不是有效的 .kmod（缺少 mod.json 或 id）")?;
    let id = m["id"].as_str().unwrap_or("").to_string();
    if !valid_id(&id) || expect.is_some_and(|e| e != id) {
        return Err("包里的模组 id 和预期不一致".into());
    }
    if is_native(&m) && !opts.allow_native {
        return Err("NATIVE_CONFIRM".into());
    }
    let update = list(kmod).iter().any(|x| x.id == id);
    let plan = pakmods::plan(kmod, &opts.paks, src, &m, update)?;
    if plan.confirm && !opts.allow_paks {
        return Err(format!("PAK_CONFIRM:{}", serde_json::to_string(&plan).map_err(|e| e.to_string())?));
    }
    if plan.changes && opts.game_running {
        return Err("这个模组要改动 Pak 文件，请先关闭游戏".into());
    }
    let dir = mods_dir(kmod);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // paks first: when one cannot be replaced the installed version stays as it was
    pakmods::apply(kmod, &opts.paks, src, &id, &plan)?;
    remove_copies(kmod, &id)?;
    std::fs::copy(src, dir.join(format!("{id}.kmod"))).map_err(|e| e.to_string())?;
    set_enabled(kmod, &id, true)?;
    Ok(m["name"].as_str().unwrap_or(&id).to_string())
}

/// Copies a `.kmod` file or a mod folder into kmod\mods. Returns the mod's name.
pub fn install(kmod: &Path, source: &str, opts: &Opts) -> Result<String, String> {
    let src = PathBuf::from(source);
    let dir = mods_dir(kmod);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if src.is_dir() {
        let m = std::fs::read_to_string(src.join("mod.json"))
            .ok()
            .and_then(|s| parse_manifest(&s))
            .ok_or("这个文件夹里没有有效的 mod.json")?;
        if !m["paks"].is_null() {
            return Err("含 Pak 的模组要打包成 .kmod 安装".into());
        }
        if is_native(&m) && !opts.allow_native {
            return Err("NATIVE_CONFIRM".into());
        }
        let name = src.file_name().ok_or("路径不对")?;
        copy_dir(&src, &dir.join(name))?;
        return Ok(m["name"].as_str().or(m["id"].as_str()).unwrap_or("").to_string());
    }
    let ext_ok = src.extension().map(|e| e.eq_ignore_ascii_case("kmod")).unwrap_or(false);
    if !ext_ok {
        return Err("只能安装 .kmod 文件或模组文件夹".into());
    }
    install_package(kmod, &src, None, opts)
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

pub fn delete(kmod: &Path, file: &str, id: &str, pending: bool) -> Result<(), String> {
    // `file` comes from the UI: it must be a plain name inside kmod\mods.
    if file.is_empty() || file.contains(['/', '\\']) || file == "." || file == ".." {
        return Err("文件名不合法".into());
    }
    let p = if pending { kmod.join("inbox").join(file) } else { mods_dir(kmod).join(file) };
    if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
    } else if p.is_file() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    if valid_id(id) {
        let private = kmod.to_path_buf().join(".private").join("mods").join(id);
        let _ = std::fs::remove_dir_all(private);
        set_enabled(kmod, id, false)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn icons_from_folders_and_packages() {
        let root = std::env::temp_dir().join(format!("kmod-icon-test-{}", std::process::id()));
        let mods = root.join("mods");
        std::fs::create_dir_all(mods.join("a/art")).unwrap();
        std::fs::write(mods.join("a/mod.json"), r#"{"id":"a","icon":"art/i.png"}"#).unwrap();
        std::fs::write(mods.join("a/art/i.png"), b"PNG").unwrap();
        let f = std::fs::File::create(mods.join("b.kmod")).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let o = zip::write::SimpleFileOptions::default();
        z.start_file("mod.json", o).unwrap();
        z.write_all(br#"{"id":"b"}"#).unwrap();
        z.start_file("icon.png", o).unwrap();
        z.write_all(b"PNG").unwrap();
        z.finish().unwrap();
        let all = list(&root);
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().all(|m| m.icon == "data:image/png;base64,UE5H"), "{all:?}");
        for bad in ["../x.png", "C:/x.png", "/x.png", "x.svg"] {
            assert!(icon_name(&json!({ "icon": bad })).is_none(), "{bad}");
        }
    }
}
