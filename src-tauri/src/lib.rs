mod android;
mod commands;
mod config;
mod game;
mod icon;
mod install;
mod mods;
mod net;
mod pakmods;
mod paks;
mod paths;
mod selfupdate;
mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    selfupdate::clean_up();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(android::plugin())
        .setup(|app| {
            icon::apply(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::platform,
            commands::android_info,
            commands::android_request_access,
            commands::android_request_apps,
            commands::android_pick,
            commands::android_installer,
            commands::get_config,
            commands::save_config,
            commands::detect_games,
            commands::check_game,
            commands::game_running,
            commands::launch_game,
            commands::get_installed,
            commands::list_releases,
            commands::install_loader,
            commands::uninstall_loader,
            commands::list_mods,
            commands::set_mod_enabled,
            commands::install_mod,
            commands::fetch_catalog,
            commands::install_remote,
            commands::delete_mod,
            commands::pak_order,
            commands::set_pak_order,
            commands::read_log,
            commands::open_path,
            commands::open_url,
            commands::get_icon,
            commands::set_icon,
            commands::reset_icon,
            commands::check_update,
            commands::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start KMod Launcher");
}
