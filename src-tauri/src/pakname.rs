//! Windows: the game mounts `Content\Paks` itself and decides a pak's priority from its file name. A name ending in
//! `_<n>_P.pak` gets `(n + 1) * 100` on top of the folder's base priority, so the load order is set by renaming:
//! `X_P.pak` becomes `X_P.kmod_03_P.pak` (the tag `.kmod_<n>_P`, sidecar files alike). Everything that remembers paks
//! (pak-owners.json, mod.json) keeps the original ("logical") name; this module maps between the two.
//! The loader does the same (core/lua/modloader.lua, core/src/pak_mods.cpp).

use std::path::Path;

pub const OFF: &str = ".disable";

/// "X_P.kmod_03_P" -> Some(("X_P", 3))
fn split_tag(stem: &str) -> Option<(&str, u32)> {
    let rest = stem.strip_suffix("_P")?;
    let (base, n) = rest.rsplit_once(".kmod_")?;
    (!base.is_empty() && !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())).then(|| (base, n.parse().unwrap_or(0)))
}

/// The stem without any order tag.
pub fn logical_stem(stem: &str) -> &str {
    let mut s = stem;
    while let Some((base, _)) = split_tag(s) {
        s = base;
    }
    s
}

/// "X_P.kmod_03_P.pak" -> "X_P.pak" (a `.disable` suffix is kept off: pass names without it)
pub fn logical(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) => format!("{}.{ext}", logical_stem(stem)),
        None => name.to_string(),
    }
}

/// The order tag of a disk stem, if it has one.
pub fn tag_of(stem: &str) -> Option<u32> {
    split_tag(stem).map(|t| t.1)
}

pub fn tagged_stem(logical_stem: &str, n: u32) -> String {
    format!("{logical_stem}.kmod_{n:02}_P")
}

/// Names in the folder (without `.disable`) whose logical name is `logical`. The exact name comes first.
pub fn on_disk(paks: &Path, logical_name: &str) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(paks) else { return out };
    for e in rd.flatten() {
        let n = e.file_name().to_string_lossy().to_string();
        let plain = n.strip_suffix(OFF).unwrap_or(&n).to_string();
        if logical(&plain).eq_ignore_ascii_case(logical_name) && !out.contains(&plain) {
            out.push(plain);
        }
    }
    out.sort_by_key(|n| !n.eq_ignore_ascii_case(logical_name));
    out
}

/// The name a file with this logical name is written under: the name it has now, else the tag of its `.pak`.
pub fn target(paks: &Path, logical_name: &str) -> String {
    if let Some(n) = on_disk(paks, logical_name).into_iter().find(|n| tag_of(n.rsplit_once('.').map_or("", |s| s.0)).is_some()) {
        return n;
    }
    let Some((stem, ext)) = logical_name.rsplit_once('.') else { return logical_name.into() };
    let pak = format!("{stem}.pak");
    on_disk(paks, &pak)
        .iter()
        .find_map(|n| tag_of(n.rsplit_once('.').map_or("", |s| s.0)))
        .map(|t| format!("{}.{ext}", tagged_stem(stem, t)))
        .unwrap_or_else(|| logical_name.into())
}

/// The priority the engine gives a mod pak in Content\Paks (UE's GetPakOrderFromPakFilePath and the `_P` rule).
pub fn priority(name: &str) -> u32 {
    let lower = name.to_ascii_lowercase();
    let mut order = 3;
    if lower.ends_with("_p.pak") {
        let mut chunk = 1;
        if let Some(end) = name.rfind('_') {
            if let Some(start) = name[..end].rfind('_') {
                let v = &name[start + 1..end];
                if !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()) {
                    if let Ok(n) = v.parse::<u32>() {
                        if n >= 1 {
                            chunk = n + 1;
                        }
                    }
                }
            }
        }
        order += 100 * chunk;
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_priorities() {
        assert_eq!(logical("X_P.kmod_03_P.pak"), "X_P.pak");
        assert_eq!(logical("X.kmod_12_P.utoc"), "X.utoc");
        assert_eq!(logical("Mod_2_P.pak"), "Mod_2_P.pak");
        assert_eq!(logical("中文_P.kmod_01_P.pak"), "中文_P.pak");
        assert_eq!(priority("mod.pak"), 3);
        assert_eq!(priority("mod_P.pak"), 103);
        assert_eq!(priority("mod_1_P.pak"), 203);
        assert_eq!(priority("X_P.kmod_03_P.pak"), 403);
        let dir = std::env::temp_dir().join(format!("kmod-pakname-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("A_P.kmod_02_P.pak.disable"), b"").unwrap();
        assert_eq!(on_disk(&dir, "A_P.pak"), ["A_P.kmod_02_P.pak"]);
        assert_eq!(target(&dir, "A_P.pak"), "A_P.kmod_02_P.pak");
        assert_eq!(target(&dir, "A_P.utoc"), "A_P.kmod_02_P.utoc");
        assert_eq!(target(&dir, "B_P.pak"), "B_P.pak");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
