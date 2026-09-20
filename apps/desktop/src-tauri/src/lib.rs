pub mod commands;
mod platform;
pub mod playback;

use playback::Player;
use tauri::Manager;

/// The app's command surface, in one place so tests mount exactly what ships.
/// A command that is implemented but never registered here is invisible to the
/// frontend, which is the failure this exists to make impossible.
#[macro_export]
macro_rules! ytbm_commands {
    () => {
        tauri::generate_handler![
            $crate::commands::platform_summary,
            $crate::commands::player_subscribe,
            $crate::commands::player_load,
            $crate::commands::player_play,
            $crate::commands::player_pause,
            $crate::commands::player_seek,
            $crate::commands::player_set_volume,
            $crate::commands::player_stop
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("the main window is declared in tauri.conf.json");
            platform::window::apply_backdrop(&window);

            // A missing or too-old libmpv is the one startup failure worth
            // naming precisely: the app is a music player without it.
            let player = Player::new()?;
            app.manage(player);
            Ok(())
        })
        .invoke_handler(ytbm_commands!())
        .run(tauri::generate_context!())
        .expect("error while running ytbm");
}
