pub mod account;
pub mod botguard;
pub mod commands;
pub mod http;
pub mod images;
pub mod library;
pub mod platform;
pub mod playback;
pub mod settings;
mod tray;
pub mod updates;

use account::{Account, OsKeyring};
use library::Library;
use platform::media::MediaSession;
use playback::Player;
use settings::SettingsStore;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// The commands the frontend's types are generated from, for runtime `$r`, in
/// one place so tests mount exactly what ships and the bindings name exactly
/// what is registered. A macro because `collect_commands!` cannot name an
/// outer generic. `http_fetch` is not here: it takes and returns raw bytes,
/// which specta has no type for, so `ymusic_invoke_handler!` routes it by name.
#[macro_export]
macro_rules! ymusic_specta {
    ($r:ty) => {{
        use $crate::commands::*;
        tauri_specta::Builder::<$r>::new()
            .commands(tauri_specta::collect_commands![
                platform_summary::<$r>,
                player_subscribe,
                player_load,
                player_queue_next,
                player_play,
                player_pause,
                player_seek,
                player_set_volume,
                player_stop,
                player_audio_devices,
                player_stats,
                media_subscribe,
                media_set_track,
                media_set_volume,
                library_folders,
                library_folder_cover,
                library_add_folder,
                library_remove_folder,
                library_scan,
                library_tracks,
                library_search,
                library_resolve,
                library_open_folder,
                library_reveal,
                account_cookie,
                account_sign_in::<$r>,
                account_browsers,
                account_import,
                account_refresh,
                account_rotate,
                account_sign_out,
                settings_get,
                settings_set::<$r>,
                update_check::<$r>,
                open_logs_folder::<$r>,
                cache_size,
                cache_clear::<$r>,
            ])
            .constant("defaultSettings", $crate::settings::Settings::default())
            // Commands reject with their error string, as a plain `invoke` does.
            .error_handling(tauri_specta::ErrorHandlingMode::Throw)
            // The 64-bit integers that cross are milliseconds, byte counts and
            // itags, all far below 2^53, so `number` holds them exactly.
            .dangerously_cast_bigints_to_number()
    }};
}

/// Every command the frontend can call, for runtime `$r`: the specta ones and
/// `http_fetch`.
#[macro_export]
macro_rules! ymusic_invoke_handler {
    ($r:ty) => {{
        let typed = $crate::ymusic_specta!($r).invoke_handler();
        let raw =
            $crate::handler_for::<$r, _>(tauri::generate_handler![$crate::commands::http_fetch]);
        move |invoke: tauri::ipc::Invoke<$r>| match invoke.message.command() {
            "http_fetch" => raw(invoke),
            _ => typed(invoke),
        }
    }};
}

/// Gives `generate_handler!`'s closure its runtime, which it cannot infer.
#[doc(hidden)]
pub fn handler_for<R: tauri::Runtime, F: Fn(tauri::ipc::Invoke<R>) -> bool>(handler: F) -> F {
    handler
}

/// Where the generated bindings live, beside the wrappers that use them.
pub const BINDINGS_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/ipc/src/bindings.ts"
);

/// Writes the TypeScript bindings for every command and the types they carry.
pub fn export_bindings(path: &std::path::Path) -> Result<(), String> {
    ymusic_specta!(tauri::Wry)
        .export(
            specta_typescript::Typescript::default()
                .header("// Run `pnpm bindings` after changing a command or a type it carries."),
            path,
        )
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch hands over to the running window before
        // anything else starts, a second player above all.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_window(app);
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
            tray::sync(app.handle(), startup_settings.close_to_tray);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && tray::keeps_playing(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(ymusic_invoke_handler!(tauri::Wry))
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
