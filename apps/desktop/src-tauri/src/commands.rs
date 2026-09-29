//! Every `#[tauri::command]` in the app.
//!
//! They live in their own module because `#[tauri::command]` generates helper
//! macros beside each function, and those collide with the crate root once the
//! functions are public enough for `ymusic_commands!` to name them.

use crate::account::{import, sign_in, Account};
use crate::http::Http;
use crate::platform::InstallFlavor;
use crate::playback::{AudioDevice, LoadRequest, PlaybackEvent, Player};
use crate::settings::{Settings, SettingsStore};
use tauri::{ipc::Channel, Manager, Runtime, State};

/// What the app knows about where it is running. The frontend shows some of it
/// on the about screen; the updater decides what it may do with the rest.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSummary {
    os: String,
    arch: String,
    app_version: String,
    install_flavor: InstallFlavor,
    supports_in_app_update: bool,
}

#[tauri::command]
pub fn platform_summary<R: Runtime>(app: tauri::AppHandle<R>) -> PlatformSummary {
    let flavor = InstallFlavor::current();
    PlatformSummary {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_version: app.package_info().version.to_string(),
        install_flavor: flavor,
        supports_in_app_update: flavor.supports_in_app_update(),
    }
}

/// Sends one of the engine's requests, framed as `http::Http::fetch` describes.
#[tauri::command]
pub async fn http_fetch(
    http: State<'_, Http>,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(frame) = request.body() else {
        return Err("http_fetch takes raw bytes".into());
    };
    Ok(tauri::ipc::Response::new(http.fetch(frame).await?))
}

#[tauri::command]
pub fn player_subscribe(player: State<'_, Player>, channel: Channel<PlaybackEvent>) {
    player.subscribe(channel);
}

#[tauri::command]
pub fn player_load(player: State<'_, Player>, request: LoadRequest) -> Result<(), String> {
    player.load(request)
}

#[tauri::command]
pub fn player_play(player: State<'_, Player>) -> Result<(), String> {
    player.play()
}

#[tauri::command]
pub fn player_pause(player: State<'_, Player>) -> Result<(), String> {
    player.pause()
}

#[tauri::command]
pub fn player_seek(player: State<'_, Player>, position_ms: u64) -> Result<(), String> {
    player.seek(position_ms)
}

#[tauri::command]
pub fn player_set_volume(player: State<'_, Player>, volume: f64) -> Result<(), String> {
    player.set_volume(volume)
}

#[tauri::command]
pub fn player_audio_devices(player: State<'_, Player>) -> Result<Vec<AudioDevice>, String> {
    player.audio_devices()
}

#[tauri::command]
pub fn player_stop(player: State<'_, Player>) -> Result<(), String> {
    player.stop()
}

// -- OS media session ---------------------------------------------------------

use crate::platform::media::{MediaKeyEvent, MediaSession, MediaTrack};

#[tauri::command]
pub fn media_subscribe(media: State<'_, MediaSession>, channel: Channel<MediaKeyEvent>) {
    media.subscribe(channel);
}

#[tauri::command]
pub fn media_set_track(media: State<'_, MediaSession>, track: Option<MediaTrack>) {
    media.set_track(track);
}

#[tauri::command]
pub fn media_set_volume(media: State<'_, MediaSession>, volume: f64) {
    media.set_volume(volume);
}

// -- Local library -----------------------------------------------------------

use crate::library::{Library, LocalLease, LocalTrack, ScanReport};

#[tauri::command]
pub fn library_folders(library: State<'_, Library>) -> Result<Vec<String>, String> {
    library.folders().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_add_folder(library: State<'_, Library>, path: String) -> Result<ScanReport, String> {
    let path = std::path::PathBuf::from(path);
    library.add_folder(&path).map_err(|e| e.to_string())?;
    // Scanning here rather than making the caller do it keeps "add a folder"
    // a single user-visible action that either works or reports why not.
    library.scan_folder(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_remove_folder(library: State<'_, Library>, path: String) -> Result<(), String> {
    library.remove_folder(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_scan(library: State<'_, Library>) -> Result<ScanReport, String> {
    library.scan_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_tracks(library: State<'_, Library>) -> Result<Vec<LocalTrack>, String> {
    library.tracks().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_search(
    library: State<'_, Library>,
    query: String,
) -> Result<Vec<LocalTrack>, String> {
    library.search(&query).map_err(|e| e.to_string())
}

/// The local half of stream resolution. Returns the same shape the YouTube
/// resolver will, so the frontend can treat the two interchangeably.
#[tauri::command]
pub fn library_resolve(library: State<'_, Library>, id: String) -> Result<LocalLease, String> {
    library.resolve(&id).map_err(|e| e.to_string())
}

/// Opens a library folder in the file manager. Only folders in the library,
/// so the webview cannot open arbitrary paths. Async to keep the file
/// manager's D-Bus call off the main thread.
#[tauri::command]
pub async fn library_open_folder(library: State<'_, Library>, path: String) -> Result<(), String> {
    let known = library.folders().map_err(|e| e.to_string())?;
    if !known.contains(&path) {
        return Err(format!("not a library folder: {path}"));
    }
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

/// Shows a local track's file in the file manager, selected. Takes the track
/// id rather than a path for the same reason as `library_open_folder`.
#[tauri::command]
pub async fn library_reveal(library: State<'_, Library>, id: String) -> Result<(), String> {
    let track = library.track(&id).map_err(|e| e.to_string())?;
    if !std::path::Path::new(&track.path).exists() {
        return Err("The file is no longer there".into());
    }
    tauri_plugin_opener::reveal_item_in_dir(&track.path).map_err(|e| e.to_string())
}

/// The saved session's cookie header, for the engine worker to send. None when
/// signed out.
#[tauri::command]
pub fn account_cookie(account: State<'_, Account>) -> Option<String> {
    account.cookie()
}

/// Opens Google's sign-in and resolves once it completes. `None` means the user
/// closed the window, which is a cancel rather than an error.
#[tauri::command]
pub async fn account_sign_in<R: Runtime>(
    app: tauri::AppHandle<R>,
    account: State<'_, Account>,
) -> Result<Option<String>, String> {
    let cookie = sign_in::sign_in(&app).await?;
    if let Some(cookie) = &cookie {
        account.save(cookie.clone());
    }
    Ok(cookie)
}

/// The browser profiles a session can be imported from.
#[tauri::command]
pub async fn account_browsers() -> Result<Vec<import::Browser>, String> {
    tauri::async_runtime::spawn_blocking(import::browsers)
        .await
        .map_err(|error| error.to_string())
}

/// Takes the YouTube session from a browser profile listed by `account_browsers`.
#[tauri::command]
pub async fn account_import(account: State<'_, Account>, id: String) -> Result<String, String> {
    // Reading the keyring can wait on an unlock prompt.
    let cookie = tauri::async_runtime::spawn_blocking(move || import::import(&id))
        .await
        .map_err(|error| error.to_string())??;
    account.save(cookie.clone());
    Ok(cookie)
}

#[tauri::command]
pub fn account_sign_out(account: State<'_, Account>) -> Result<(), String> {
    account.clear()
}

#[tauri::command]
pub fn settings_get(settings: State<'_, SettingsStore>) -> Settings {
    settings.get()
}

/// Changes the settings named in `patch`, applies the ones mpv owns, and
/// returns all of them.
#[tauri::command]
pub fn settings_set<R: Runtime>(
    app: tauri::AppHandle<R>,
    settings: State<'_, SettingsStore>,
    patch: serde_json::Value,
) -> Result<Settings, String> {
    let next = settings.update(patch)?;
    if let Some(player) = app.try_state::<Player>() {
        player.apply_settings(&next);
    }
    crate::tray::sync(&app, next.close_to_tray);
    Ok(next)
}
