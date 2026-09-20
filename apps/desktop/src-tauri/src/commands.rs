//! Every `#[tauri::command]` in the app.
//!
//! They live in their own module because `#[tauri::command]` generates helper
//! macros beside each function, and those collide with the crate root once the
//! functions are public enough for `ytbm_commands!` to name them.

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
