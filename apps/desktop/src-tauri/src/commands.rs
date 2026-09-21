//! Every `#[tauri::command]` in the app.
//!
//! They live in their own module because `#[tauri::command]` generates helper
//! macros beside each function, and those collide with the crate root once the
//! functions are public enough for `ymusic_commands!` to name them.

use crate::account::{sign_in, Account};
use crate::platform::InstallFlavor;
use crate::playback::{LoadRequest, PlaybackEvent, Player};
use tauri::{ipc::Channel, Runtime, State};

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
pub fn library_add_folder(
    library: State<'_, Library>,
    path: String,
) -> Result<ScanReport, String> {
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

#[tauri::command]
pub fn account_sign_out(account: State<'_, Account>) -> Result<(), String> {
    account.clear()
}
