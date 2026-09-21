pub mod account;
pub mod botguard;
pub mod commands;
pub mod images;
pub mod platform;
pub mod library;
pub mod playback;

use account::{Account, OsKeyring};
use library::Library;
use platform::media::MediaSession;
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
            $crate::commands::player_stop,
            $crate::commands::media_subscribe,
            $crate::commands::media_set_track,
            $crate::commands::media_set_volume,
            $crate::commands::library_folders,
            $crate::commands::library_add_folder,
            $crate::commands::library_remove_folder,
            $crate::commands::library_scan,
            $crate::commands::library_tracks,
            $crate::commands::library_search,
            $crate::commands::library_resolve,
            $crate::commands::account_cookie,
            $crate::commands::account_sign_in,
            $crate::commands::account_sign_out
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                // The MPRIS backend's async runtime traces every poll, which
                // buries everything else in the log within seconds.
                .level_for("zbus", log::LevelFilter::Warn)
                .level_for("polling", log::LevelFilter::Warn)
                .level_for("async_io", log::LevelFilter::Warn)
                .level_for("tracing", log::LevelFilter::Warn)
                // One line per connection and a "shouldn't retry!" per
                // request: noise that reads like errors and is not.
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("hyper_util", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol(botguard::SCHEME, |_, request| botguard::respond(&request))
        .register_asynchronous_uri_scheme_protocol(images::SCHEME, |context, request, responder| {
            let images = context.app_handle().state::<images::Images>().inner().clone();
            tauri::async_runtime::spawn(async move {
                responder.respond(images.respond(&request).await);
            });
        })
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("the main window is declared in tauri.conf.json");
            platform::window::apply_backdrop(&window);

            // A missing or too-old libmpv is the one startup failure worth
            // naming precisely: the app is a music player without it.
            let player = Player::new()?;
            // Media keys are a nicety; `attach` logs and carries on without
            // them rather than failing startup.
            let media = MediaSession::attach(&window);
            player.observe(media.clone());
            app.manage(player);
            app.manage(media);

            app.manage(images::Images::new(cache_dir(app.handle()).join("images")));
            app.manage(open_library(app.handle()));
            app.manage(open_account(app.handle()));
            Ok(())
        })
        .invoke_handler(ytbm_commands!())
        .run(tauri::generate_context!())
        .expect("error while running ytbm");
}

/// Opens the on-disk library, falling back to an in-memory one if the data
/// directory cannot be used. A player that forgets your folders on restart is
/// a much better outcome than a player that refuses to start.
fn open_library<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Library {
    let art_dir = cache_dir(app).join("art");

    let db_path = app.path().app_data_dir().map(|dir| dir.join("library.sqlite3"));

    match db_path {
        Ok(path) => match Library::open(&path, art_dir.clone()) {
            Ok(library) => return library,
            Err(err) => log::error!("falling back to an in-memory library: {err}"),
        },
        Err(err) => log::error!("no app data directory, using an in-memory library: {err}"),
    }

    Library::open_in_memory(art_dir).expect("an in-memory library cannot fail to open")
}

fn cache_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> std::path::PathBuf {
    app.path().app_cache_dir().unwrap_or_else(|_| std::env::temp_dir().join("ytbm"))
}

fn open_account<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Account {
    let dir = app.path().app_data_dir().unwrap_or_else(|err| {
        log::error!("no app data directory, the session will not persist: {err}");
        std::env::temp_dir().join("ytbm")
    });
    Account::open(dir.join("account.bin"), OsKeyring)
}
