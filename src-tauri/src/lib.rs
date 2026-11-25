mod commands;
mod config;
mod game;
mod install;
mod mods;
mod net;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
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
            commands::delete_mod,
            commands::read_log,
            commands::open_path,
            commands::open_url,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start KMod Launcher");
}
