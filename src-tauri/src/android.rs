//! Bridge to the Kotlin side of the Android app (`KModPlugin`): things Rust cannot do alone —
//! the all-files-access permission, launching the game, the system file picker and the APK installer.
//! On other platforms the same functions exist and report that they are not available.

use serde::{Deserialize, Serialize};
use tauri::{plugin::TauriPlugin, AppHandle, Wry};

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct AndroidInfo {
    /// "All files access" is granted: needed to read and write the game's Android/media folder.
    pub access: bool,
    /// The patched game is installed.
    pub installed: bool,
    pub version: String,
}

#[cfg(target_os = "android")]
pub struct Bridge(pub tauri::plugin::PluginHandle<Wry>);

#[cfg(target_os = "android")]
fn call<T: serde::de::DeserializeOwned>(app: &AppHandle, cmd: &str, payload: serde_json::Value) -> Result<T, String> {
    use tauri::Manager;
    app.state::<Bridge>().0.run_mobile_plugin(cmd, payload).map_err(|e| e.to_string())
}

pub fn plugin() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::<Wry>::new("kmodlauncher")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("team.ccb.kmod_launcher", "KModPlugin")?;
                _app.manage(Bridge(handle));
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
mod imp {
    use super::*;
    use serde_json::json;

    pub fn info(app: &AppHandle, pkg: &str) -> Result<AndroidInfo, String> {
        call(app, "info", json!({ "pkg": pkg }))
    }
    pub fn request_access(app: &AppHandle) -> Result<(), String> {
        call::<serde_json::Value>(app, "requestAccess", json!({})).map(|_| ())
    }
    pub fn launch(app: &AppHandle, pkg: &str) -> Result<(), String> {
        call::<serde_json::Value>(app, "launch", json!({ "pkg": pkg })).map(|_| ())
    }
    pub fn open_url(app: &AppHandle, url: &str) -> Result<(), String> {
        call::<serde_json::Value>(app, "openUrl", json!({ "url": url })).map(|_| ())
    }
    pub fn install_apk(app: &AppHandle, path: &str) -> Result<(), String> {
        call::<serde_json::Value>(app, "installApk", json!({ "path": path })).map(|_| ())
    }
    #[derive(Deserialize)]
    struct Picked {
        files: Vec<String>,
    }
    /// Opens the system picker; the chosen files are copied to the app cache and their paths returned.
    pub fn pick(app: &AppHandle, exts: &[String]) -> Result<Vec<String>, String> {
        call::<Picked>(app, "pick", json!({ "exts": exts })).map(|p| p.files)
    }
}

#[cfg(not(target_os = "android"))]
mod imp {
    use super::*;
    const NO: &str = "只有手机版支持这个功能";
    pub fn info(_: &AppHandle, _: &str) -> Result<AndroidInfo, String> {
        Err(NO.into())
    }
    pub fn request_access(_: &AppHandle) -> Result<(), String> {
        Err(NO.into())
    }
    pub fn launch(_: &AppHandle, _: &str) -> Result<(), String> {
        Err(NO.into())
    }
    pub fn open_url(_: &AppHandle, _: &str) -> Result<(), String> {
        Err(NO.into())
    }
    pub fn install_apk(_: &AppHandle, _: &str) -> Result<(), String> {
        Err(NO.into())
    }
    pub fn pick(_: &AppHandle, _: &[String]) -> Result<Vec<String>, String> {
        Err(NO.into())
    }
}

pub use imp::*;
