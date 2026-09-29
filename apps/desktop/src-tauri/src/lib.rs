pub mod account;
pub mod botguard;
pub mod commands;
pub mod http;
pub mod images;
pub mod library;
pub mod platform;
pub mod playback;
pub mod settings;

use account::{Account, OsKeyring};
use library::Library;
use platform::media::MediaSession;
use playback::Player;
use settings::SettingsStore;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// The app's command surface, in one place so tests mount exactly what ships.
/// A command that is implemented but never registered here is invisible to the
/// frontend, which is the failure this exists to make impossible.
#[macro_export]
macro_rules! ymusic_commands {
    () => {
        tauri::generate_handler![
            $crate::commands::platform_summary,
            $crate::commands::http_fetch,
            $crate::commands::player_subscribe,
            $crate::commands::player_load,
            $crate::commands::player_play,
            $crate::commands::player_pause,
            $crate::commands::player_seek,
            $crate::commands::player_set_volume,
            $crate::commands::player_stop,
            $crate::commands::player_audio_devices,
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
            $crate::commands::library_open_folder,
            $crate::commands::library_reveal,
            $crate::commands::account_cookie,
            $crate::commands::account_sign_in,
            $crate::commands::account_browsers,
            $crate::commands::account_import,
            $crate::commands::account_sign_out,
            $crate::commands::settings_get,
            $crate::commands::settings_set
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch hands over to the running window before
        // anything else starts, a second player above all.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
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
                // A line for every cookie YouTube sets on the engine's client.
                .level_for("cookie_store", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol(botguard::SCHEME, |_, request| botguard::respond(&request))
        .register_asynchronous_uri_scheme_protocol(images::SCHEME, |context, request, responder| {
            let images = context
                .app_handle()
                .state::<images::Images>()
                .inner()
                .clone();
            tauri::async_runtime::spawn(async move {
                responder.respond(images.respond(&request).await);
            });
        })
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("the main window is declared in tauri.conf.json");
            platform::window::apply_backdrop(&window);
            let settings = open_settings(app.handle());
            let startup_settings = settings.get();
            app.manage(settings);

            // The loader already refuses to start without `libmpv.so.2` (mpv
            // 0.35), so what can still fail here is mpv itself. The app is a
            // music player without it, so say so and quit rather than open a
            // window where nothing plays.
            match Player::new() {
                Ok(player) => {
                    // Media keys are a nicety; `attach` logs and carries on
                    // without them rather than failing startup.
                    let media = MediaSession::attach(&window);
                    player.observe(media.clone());
                    player.apply_settings(&startup_settings);
                    app.manage(player);
                    app.manage(media);
                }
                Err(error) => {
                    log::error!("{error}");
                    let _ = window.hide();
                    let handle = app.handle().clone();
                    app.dialog()
                        .message(format!(
                            "yMusic plays audio through libmpv, and it would not start.\n\n\
                             Check that mpv 0.35 or newer is installed (the libmpv2 \
                             package on Debian and Ubuntu), then open yMusic again.\n\n\
                             {error}"
                        ))
                        .title("yMusic cannot play audio")
                        .kind(MessageDialogKind::Error)
                        .show(move |_| handle.exit(1));
                }
            }

            app.manage(http::Http::new());
            app.manage(images::Images::new(cache_dir(app.handle()).join("images")));
            app.manage(open_library(app.handle()));
            app.manage(open_account(app.handle()));
            Ok(())
        })
        .invoke_handler(ymusic_commands!())
        .run(tauri::generate_context!())
        .expect("error while running ymusic");
}

/// Opens the on-disk library, falling back to an in-memory one if the data
/// directory cannot be used. A player that forgets your folders on restart is
/// a much better outcome than a player that refuses to start.
fn open_library<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Library {
    let art_dir = cache_dir(app).join("art");

    let db_path = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("library.sqlite3"));

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
    app.path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("ymusic"))
}

fn open_settings<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> SettingsStore {
    match app.path().app_data_dir() {
        Ok(dir) => SettingsStore::open(dir.join("settings.json")),
        Err(err) => {
            log::error!("no app data directory, settings will not persist: {err}");
            SettingsStore::in_memory()
        }
    }
}

fn open_account<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Account {
    let dir = app.path().app_data_dir().unwrap_or_else(|err| {
        log::error!("no app data directory, the session will not persist: {err}");
        std::env::temp_dir().join("ymusic")
    });
    Account::open(dir.join("account.bin"), OsKeyring)
}
