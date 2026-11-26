//! Pak files shipped inside a `.kmod` package: mod.json "paks" lists every file under paks/ with its SHA-256 (a pak has no
//! version number). They are installed into the normal paks folder and are ordinary pak mods from then on;
//! kmod/pak-owners.json remembers which package put which file there. The loader follows the same rules
//! (core/lua/modloader.lua), so both write the same record.

use crate::pakname;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const ENTRY_LIMIT: u64 = 512 * 1024 * 1024;
const EXTS: [&str; 4] = ["pak", "utoc", "ucas", "sig"];
const GAME_PAKS: [&str; 4] = ["kards-windows", "kards-android", "pakchunk", "global."];
use pakname::OFF;

#[cfg(target_os = "android")]
const PLATFORM: &str = "android";
#[cfg(not(target_os = "android"))]
const PLATFORM: &str = "windows";

#[derive(Debug, Clone)]
pub struct PakFile {
    pub name: String,
    entry: String,
    pub sha256: String,
    pub size: u64,
}

/// What the player is asked before pak files are overwritten or removed.
#[derive(Serialize, Debug, Default)]
pub struct Plan {
    pub name: String,
    pub version: String,
    /// Files that will be written
    pub write: Vec<String>,
    /// Files of the installed version that the new one no longer has
    pub remove: Vec<String>,
    /// Files that exist already and were not installed by this package
    pub conflicts: Vec<String>,
    #[serde(skip)]
    files: Vec<PakFile>,
    #[serde(skip)]
    pub changes: bool,
    #[serde(skip)]
    pub confirm: bool,
}

type Owners = BTreeMap<String, Value>;

fn owners_path(kmod: &Path) -> PathBuf {
    kmod.join("pak-owners.json")
}

fn read_owners(kmod: &Path) -> Owners {
    std::fs::read_to_string(owners_path(kmod))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v["mods"].as_object().map(|m| m.clone().into_iter().collect()))
        .unwrap_or_default()
}

fn write_owners(kmod: &Path, owners: &Owners) -> Result<(), String> {
    let mods: Map<String, Value> = owners.clone().into_iter().collect();
    std::fs::create_dir_all(kmod).map_err(|e| e.to_string())?;
    std::fs::write(owners_path(kmod), json!({ "mods": mods }).to_string()).map_err(|e| format!("无法记录 Pak 归属：{e}"))
}

/// (name, sha256) of the files recorded for one mod
fn files_of(record: Option<&Value>) -> Vec<(String, String)> {
    record
        .and_then(|r| r["files"].as_array())
        .map(|a| {
            a.iter()
                .filter_map(|f| Some((f["name"].as_str()?.to_string(), f["sha256"].as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

/// The pak files installed by each mod that are still there (enabled or switched off).
pub fn installed(kmod: &Path, paks: &Path) -> BTreeMap<String, Vec<String>> {
    read_owners(kmod)
        .into_iter()
        .map(|(id, r)| {
            let names = files_of(Some(&r))
                .into_iter()
                .map(|f| f.0)
                .filter(|n| valid_name(n) && current(kmod, paks, n).is_some())
                .collect();
            (id, names)
        })
        .collect()
}

/// A plain pak file name that is not one of the game's own.
fn valid_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        && !GAME_PAKS.iter().any(|g| lower.starts_with(g))
        && lower.rsplit_once('.').is_some_and(|(stem, ext)| !stem.is_empty() && EXTS.contains(&ext))
}

/// Where a file of that name is now: waiting in pak-staged, in the paks folder (perhaps renamed for the load order, see
/// pakname.rs), or switched off there.
fn current(kmod: &Path, paks: &Path, name: &str) -> Option<PathBuf> {
    let staged = kmod.join("pak-staged").join(name);
    if staged.is_file() {
        return Some(staged);
    }
    pakname::on_disk(paks, name)
        .into_iter()
        .flat_map(|n| [paks.join(&n), paks.join(format!("{n}{OFF}"))])
        .find(|p| p.is_file())
}

/// Deletes a file under every name it has in the paks folder, on or off.
fn delete_everywhere(paks: &Path, name: &str) -> Result<(), String> {
    for n in pakname::on_disk(paks, name) {
        delete_file(&paks.join(&n))?;
        delete_file(&paks.join(format!("{n}{OFF}")))?;
    }
    Ok(())
}

/// A package with paks must keep older loaders out: they would install the Lua part and silently drop the paks.
fn requires_new_loader(m: &Value) -> bool {
    m["depends"].as_array().into_iter().flatten().filter_map(|d| d.as_str()).any(|d| {
        let Some(rest) = d.trim().strip_prefix("kmod") else { return false };
        rest.split(',').any(|c| {
            let c = c.trim();
            let version = c.trim_start_matches(['>', '=']).trim().trim_start_matches('v');
            let op = &c[..c.len() - c.trim_start_matches(['>', '=']).len()];
            let mut parts = version.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
            let v = (parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0));
            match op {
                ">=" | "=" | "==" => v >= (0, 4, 0),
                ">" => v >= (0, 3, 999),
                _ => false,
            }
        })
    })
}

fn applies_here(v: &Value) -> Option<bool> {
    let here = |s: &str| s.eq_ignore_ascii_case(PLATFORM);
    match v {
        Value::Null => Some(true),
        Value::String(s) => Some(here(s)),
        Value::Array(a) => Some(a.iter().filter_map(|p| p.as_str()).any(here)),
        _ => None,
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Copies `from` into `to`, returning the checksum of what was read.
fn hashed_copy(from: &mut impl Read, mut to: impl Write) -> std::io::Result<String> {
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = from.read(&mut buf)?;
        if n == 0 {
            to.flush()?;
            return Ok(hex(&h.finalize()));
        }
        h.update(&buf[..n]);
        to.write_all(&buf[..n])?;
    }
}

fn open_zip(path: &Path) -> Result<zip::ZipArchive<std::fs::File>, String> {
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    zip::ZipArchive::new(f).map_err(|e| format!("这个 .kmod 打不开：{e}"))
}

/// The package's pak files for this platform, after checking every declaration against the zip.
fn package_files(src: &Path, m: &Value) -> Result<Vec<PakFile>, String> {
    let mut z = open_zip(src)?;
    let in_zip: HashSet<String> = z
        .file_names()
        .filter(|n| !n.ends_with('/') && n.get(..5).is_some_and(|p| p.eq_ignore_ascii_case("paks/")))
        .map(String::from)
        .collect();
    if m["paks"].is_null() {
        return if in_zip.is_empty() { Ok(Vec::new()) } else { Err("包里 paks/ 下的文件必须在 mod.json 的 \"paks\" 里声明".into()) };
    }
    let list = m["paks"].as_array().filter(|a| !a.is_empty()).ok_or("mod.json 的 \"paks\" 必须是非空列表")?;
    if !requires_new_loader(m) {
        return Err("含 Pak 的模组包必须声明 \"depends\": [\"kmod>=0.4.0\"]".into());
    }
    let (mut declared, mut taken, mut wanted) = (HashSet::new(), HashSet::new(), Vec::new());
    for p in list {
        let file = p["file"].as_str().filter(|f| f.starts_with("paks/")).ok_or("\"paks\" 的每一项都要有 \"file\": \"paks/…\"")?;
        let name = file.rsplit('/').next().unwrap_or("");
        if !valid_name(name) {
            return Err(format!("Pak 文件名不能用（扩展名不对，或与游戏本体重名）：{file}"));
        }
        let sha = p["sha256"]
            .as_str()
            .map(str::to_ascii_lowercase)
            .filter(|s| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()))
            .ok_or_else(|| format!("缺少或写错了 sha256：{file}"))?;
        if !declared.insert(file.to_string()) {
            return Err(format!("重复声明：{file}"));
        }
        if !in_zip.contains(file) {
            return Err(format!("声明了但包里没有：{file}"));
        }
        let here = applies_here(&p["platforms"]).ok_or_else(|| format!("platforms 写法不对：{file}"))?;
        let mut entry = z.by_name(file).map_err(|e| e.to_string())?;
        let size = entry.size();
        if size > ENTRY_LIMIT {
            return Err(format!("文件太大（上限 512 MB）：{file}"));
        }
        let actual = hashed_copy(&mut (&mut entry).take(ENTRY_LIMIT), std::io::sink()).map_err(|e| format!("{file}：{e}"))?;
        if actual != sha {
            return Err(format!("校验不一致（SHA-256）：{file}"));
        }
        if here {
            if !taken.insert(name.to_ascii_lowercase()) {
                return Err(format!("同一平台有两个同名文件：{name}"));
            }
            wanted.push(PakFile { name: name.into(), entry: file.into(), sha256: sha, size });
        }
    }
    if let Some(extra) = in_zip.iter().find(|f| !declared.contains(*f)) {
        return Err(format!("包里有但没有声明：{extra}"));
    }
    for w in &wanted {
        let stem = w.name.rsplit_once('.').map(|s| s.0).unwrap_or("");
        if !taken.contains(&format!("{stem}.pak").to_ascii_lowercase()) {
            return Err(format!("{} 旁边缺少同名的 .pak", w.name));
        }
    }
    Ok(wanted)
}

/// What installing `src` would do to the pak files. `update`: a version of this mod is installed already.
pub fn plan(kmod: &Path, paks: &Path, src: &Path, m: &Value, update: bool) -> Result<Plan, String> {
    let files = package_files(src, m)?;
    let id = m["id"].as_str().unwrap_or("");
    let owners = read_owners(kmod);
    let old: BTreeMap<String, String> = files_of(owners.get(id)).into_iter().collect();
    let mut p = Plan {
        name: m["name"].as_str().unwrap_or(id).into(),
        version: m["version"].as_str().map(String::from).unwrap_or_else(|| m["version"].to_string()),
        ..Plan::default()
    };
    p.remove = old.keys().filter(|n| valid_name(n) && !files.iter().any(|f| &f.name == *n)).cloned().collect();
    p.changes = !p.remove.is_empty() || files.iter().any(|f| old.get(&f.name) != Some(&f.sha256));
    if p.changes {
        for f in &files {
            match current(kmod, paks, &f.name) {
                // a new version overwrites its own files; also puts back ones the player deleted
                None => p.write.push(f.name.clone()),
                Some(_) if old.contains_key(&f.name) => {
                    if old[&f.name] != f.sha256 {
                        p.write.push(f.name.clone());
                    }
                }
                Some(cur) => {
                    let mut file = std::fs::File::open(&cur).map_err(|e| e.to_string())?;
                    // the identical file is simply taken over
                    if hashed_copy(&mut file, std::io::sink()).map_err(|e| e.to_string())? != f.sha256 {
                        p.write.push(f.name.clone());
                        let owner = owners.iter().find(|(o, r)| o.as_str() != id && files_of(Some(r)).iter().any(|x| x.0 == f.name));
                        p.conflicts.push(match owner {
                            Some((o, _)) => format!("{}（{o}）", f.name),
                            None => f.name.clone(),
                        });
                    }
                }
            }
        }
        p.confirm = !p.conflicts.is_empty() || !p.remove.is_empty() || (!p.write.is_empty() && (update || !old.is_empty()));
    }
    p.files = files;
    Ok(p)
}

fn locked(path: &Path, e: std::io::Error) -> String {
    if e.raw_os_error() == Some(32) || e.kind() == std::io::ErrorKind::PermissionDenied {
        format!("{} 被占用，请先关闭游戏", path.display())
    } else {
        format!("{}：{e}", path.display())
    }
}

fn delete_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(locked(path, e)),
        _ => Ok(()),
    }
}

/// Forgets what the loader had staged for these names: this installation is newer.
fn unstage<'a>(kmod: &Path, names: impl Iterator<Item = &'a String>) -> Result<(), String> {
    for n in names {
        delete_file(&kmod.join("pak-staged").join(n))?;
        delete_file(&kmod.join("pak-staged").join(format!("{n}.del")))?;
    }
    Ok(())
}

/// Carries out a plan (the game must not be running). A pak the player switched off stays off.
pub fn apply(kmod: &Path, paks: &Path, src: &Path, id: &str, p: &Plan) -> Result<(), String> {
    if !p.changes {
        return Ok(());
    }
    std::fs::create_dir_all(paks).map_err(|e| e.to_string())?;
    let part = |n: &str| paks.join(format!("{n}.part"));
    let mut z = open_zip(src)?;
    // everything is extracted and checked before anything is replaced
    let extracted = (|| {
        for f in p.files.iter().filter(|f| p.write.contains(&f.name)) {
            let mut entry = z.by_name(&f.entry).map_err(|e| e.to_string())?;
            let out = std::fs::File::create(part(&f.name)).map_err(|e| locked(&part(&f.name), e))?;
            let sha = hashed_copy(&mut (&mut entry).take(ENTRY_LIMIT), out).map_err(|e| format!("写入 {} 失败：{e}", f.name))?;
            if sha != f.sha256 {
                return Err(format!("校验不一致（SHA-256）：{}", f.name));
            }
        }
        Ok(())
    })();
    if let Err(e) = extracted {
        for n in &p.write {
            let _ = std::fs::remove_file(part(n));
        }
        return Err(e);
    }
    // .pak files first: their state decides where new sidecar files go
    let mut order = p.write.clone();
    order.sort_by_key(|n| !n.to_ascii_lowercase().ends_with(".pak"));
    for n in &order {
        // a pak renamed for the load order keeps its name, and new sidecar files get the same one
        let disk = pakname::target(paks, n);
        let stem = disk.rsplit_once('.').map(|s| s.0).unwrap_or(&disk);
        let off = paks.join(format!("{disk}{OFF}"));
        let to = if off.is_file() || paks.join(format!("{stem}.pak{OFF}")).is_file() {
            delete_file(&paks.join(&disk))?;
            off
        } else {
            paks.join(&disk)
        };
        delete_file(&to)?;
        std::fs::rename(part(n), &to).map_err(|e| locked(&to, e))?;
    }
    for n in &p.remove {
        delete_everywhere(paks, n)?;
    }
    unstage(kmod, p.write.iter().chain(&p.remove))?;
    let mut owners = read_owners(kmod);
    for (other, r) in owners.iter_mut() {
        if other != id {
            if let Some(a) = r["files"].as_array_mut() {
                a.retain(|x| !p.files.iter().any(|f| x["name"] == f.name.as_str()));
            }
        }
    }
    if p.files.is_empty() {
        owners.remove(id);
    } else {
        let files: Vec<Value> = p.files.iter().map(|f| json!({ "name": f.name, "sha256": f.sha256, "size": f.size })).collect();
        owners.insert(id.into(), json!({ "version": p.version, "files": files }));
    }
    write_owners(kmod, &owners)
}

/// Called when a mod is deleted: deletes the paks it installed, or leaves them as ordinary pak mods.
pub fn forget(kmod: &Path, paks: &Path, id: &str, delete: bool) -> Result<(), String> {
    let mut owners = read_owners(kmod);
    let Some(record) = owners.remove(id) else { return Ok(()) };
    if delete {
        let names: Vec<String> = files_of(Some(&record)).into_iter().map(|f| f.0).filter(|n| valid_name(n)).collect();
        for n in &names {
            delete_everywhere(paks, n)?;
        }
        unstage(kmod, names.iter())?;
    }
    write_owners(kmod, &owners)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn package(path: &Path, version: &str, files: &[(&str, &[u8])]) -> Value {
        let paks: Vec<Value> = files
            .iter()
            .map(|(n, d)| json!({ "file": format!("paks/{n}"), "sha256": hex(&Sha256::digest(d)) }))
            .collect();
        let m = json!({ "id": "p", "version": version, "depends": ["kmod>=0.4.0"], "paks": paks });
        let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        z.start_file("mod.json", o).unwrap();
        z.write_all(m.to_string().as_bytes()).unwrap();
        for (n, d) in files {
            z.start_file(format!("paks/{n}"), o).unwrap();
            z.write_all(d).unwrap();
        }
        z.finish().unwrap();
        m
    }

    #[test]
    fn a_pak_renamed_for_the_load_order_is_updated_in_place() {
        let root = std::env::temp_dir().join(format!("kmod-pak-order-{}", std::process::id()));
        let (kmod, paks, src) = (root.join("kmod"), root.join("Paks"), root.join("p.kmod"));
        std::fs::create_dir_all(&kmod).unwrap();
        let m = package(&src, "1", &[("A_P.pak", b"a1"), ("B_P.pak", b"b")]);
        apply(&kmod, &paks, &src, "p", &plan(&kmod, &paks, &src, &m, false).unwrap()).unwrap();
        std::fs::rename(paks.join("A_P.pak"), paks.join("A_P.kmod_02_P.pak")).unwrap();
        assert_eq!(installed(&kmod, &paks)["p"].len(), 2);
        let m = package(&src, "2", &[("A_P.pak", b"a2"), ("A_P.utoc", b"t")]);
        let p = plan(&kmod, &paks, &src, &m, true).unwrap();
        assert!(p.conflicts.is_empty() && p.remove == ["B_P.pak"], "{p:?}");
        apply(&kmod, &paks, &src, "p", &p).unwrap();
        assert_eq!(std::fs::read(paks.join("A_P.kmod_02_P.pak")).unwrap(), b"a2");
        assert!(paks.join("A_P.kmod_02_P.utoc").is_file() && !paks.join("A_P.pak").exists() && !paks.join("B_P.pak").exists());
        forget(&kmod, &paks, "p", true).unwrap();
        assert_eq!(std::fs::read_dir(&paks).unwrap().count(), 0);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn install_update_and_remove() {
        let root = std::env::temp_dir().join(format!("kmod-pak-test-{}", std::process::id()));
        let (kmod, paks, src) = (root.join("kmod"), root.join("Paks"), root.join("p.kmod"));
        std::fs::create_dir_all(&kmod).unwrap();

        // first installation: no question
        let m = package(&src, "1", &[("A_P.pak", b"a1"), ("B_P.pak", b"b")]);
        let p = plan(&kmod, &paks, &src, &m, false).unwrap();
        assert!(p.changes && !p.confirm, "{p:?}");
        apply(&kmod, &paks, &src, "p", &p).unwrap();
        assert_eq!(std::fs::read(paks.join("A_P.pak")).unwrap(), b"a1");
        assert!(!plan(&kmod, &paks, &src, &m, true).unwrap().changes);

        // update: asks, overwrites, removes the dropped file, keeps a switched-off pak off
        std::fs::rename(paks.join("A_P.pak"), paks.join("A_P.pak.disable")).unwrap();
        let m = package(&src, "2", &[("A_P.pak", b"a2"), ("C_P.pak", b"c")]);
        let p = plan(&kmod, &paks, &src, &m, true).unwrap();
        assert!(p.confirm);
        assert_eq!((p.write.clone(), p.remove.clone()), (vec!["A_P.pak".to_string(), "C_P.pak".to_string()], vec!["B_P.pak".to_string()]));
        apply(&kmod, &paks, &src, "p", &p).unwrap();
        assert_eq!(std::fs::read(paks.join("A_P.pak.disable")).unwrap(), b"a2");
        assert!(!paks.join("A_P.pak").exists() && !paks.join("B_P.pak").exists() && paks.join("C_P.pak").exists());
        assert_eq!(installed(&kmod, &paks)["p"].len(), 2);

        forget(&kmod, &paks, "p", true).unwrap();
        assert_eq!(std::fs::read_dir(&paks).unwrap().count(), 0);

        // a foreign file of the same name is a conflict
        std::fs::write(paks.join("C_P.pak"), b"other").unwrap();
        let p = plan(&kmod, &paks, &src, &m, false).unwrap();
        assert_eq!(p.conflicts, vec!["C_P.pak".to_string()]);
        assert!(p.confirm);

        // wrong checksum, the game's own pak, missing loader requirement
        let mut bad = m.clone();
        bad["paks"][0]["sha256"] = "0".repeat(64).into();
        assert!(plan(&kmod, &paks, &src, &bad, false).is_err());
        let mut old = m.clone();
        old["depends"] = json!(["kmod>=0.3.0"]);
        assert!(plan(&kmod, &paks, &src, &old, false).is_err());
        assert!(!valid_name("kards-Windows.pak") && !valid_name("../x.pak") && valid_name("x_P.utoc"));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
