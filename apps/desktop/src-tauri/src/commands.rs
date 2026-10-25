//! Every `#[tauri::command]` in the app.
//!
//! They live in their own module because `#[tauri::command]` generates helper
//! macros beside each function, and those collide with the crate root once the
//! functions are public enough for `ymusic_specta!` to name them.

use crate::account::{import, rotate, sign_in, Account, Session};
use crate::http::Http;
use crate::images::Images;
use crate::platform::InstallFlavor;
use crate::playback::{AudioDevice, AudioStats, LoadRequest, PlaybackEvent, Player, Position};
use crate::queue::{QueueJson, QueuePosition, QueueStore, SavedQueue};
use crate::settings::{Settings, SettingsPatch, SettingsStore};
use crate::volume::{SavedVolume, VolumeStore};
use tauri::{ipc::Channel, Manager, Runtime, State};

/// What the app knows about where it is running. The frontend shows some of it
/// on the about screen; the updater decides what it may do with the rest.
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSummary {
    os: String,
    arch: String,
    app_version: String,
    install_flavor: InstallFlavor,
    supports_in_app_update: bool,
    /// False without a system tray library, so the page can't offer the tray.
    has_tray: bool,
}

#[tauri::command]
#[specta::specta]
pub fn platform_summary<R: Runtime>(app: tauri::AppHandle<R>) -> PlatformSummary {
    let flavor = InstallFlavor::current();
    PlatformSummary {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_version: app.package_info().version.to_string(),
        install_flavor: flavor,
        supports_in_app_update: flavor.supports_in_app_update(),
        has_tray: crate::tray::has_tray_support(),
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
#[specta::specta]
pub fn player_subscribe(player: State<'_, Player>, channel: Channel<PlaybackEvent>) {
    player.subscribe(channel);
}

#[tauri::command]
#[specta::specta]
pub fn player_load(player: State<'_, Player>, request: LoadRequest) -> Result<(), String> {
    player.load(request)
}

#[tauri::command]
#[specta::specta]
pub fn player_queue_next(
    player: State<'_, Player>,
    after: String,
    request: Option<LoadRequest>,
) -> Result<(), String> {
    player.queue_next(&after, request)
}

#[tauri::command]
#[specta::specta]
pub fn player_play(player: State<'_, Player>) -> Result<(), String> {
    player.play()
}

#[tauri::command]
#[specta::specta]
pub fn player_pause(player: State<'_, Player>) -> Result<(), String> {
    player.pause()
}

#[tauri::command]
#[specta::specta]
pub fn player_seek(player: State<'_, Player>, position_ms: u64) -> Result<(), String> {
    player.seek(position_ms)
}

#[tauri::command]
#[specta::specta]
pub fn player_position(player: State<'_, Player>) -> Option<Position> {
    player.progress()
}

#[tauri::command]
#[specta::specta]
pub fn player_set_volume(player: State<'_, Player>, volume: f64) -> Result<(), String> {
    player.set_volume(volume)
}

/// The volume the last run left off at, which the player bar starts from.
#[tauri::command]
#[specta::specta]
pub fn player_saved_volume(store: State<'_, VolumeStore>) -> SavedVolume {
    store.get()
}

#[tauri::command]
#[specta::specta]
pub fn player_audio_devices(player: State<'_, Player>) -> Result<Vec<AudioDevice>, String> {
    player.audio_devices()
}

#[tauri::command]
#[specta::specta]
pub fn player_stats(player: State<'_, Player>) -> AudioStats {
    player.stats()
}

#[tauri::command]
#[specta::specta]
pub fn player_stop(player: State<'_, Player>) -> Result<(), String> {
    player.stop()
}

// -- OS media session ---------------------------------------------------------

use crate::platform::media::{MediaKeyEvent, MediaSession, MediaTrack};

#[tauri::command]
#[specta::specta]
pub fn media_subscribe(media: State<'_, MediaSession>, channel: Channel<MediaKeyEvent>) {
    media.subscribe(channel);
}

#[tauri::command]
#[specta::specta]
pub fn media_set_track(media: State<'_, MediaSession>, track: Option<MediaTrack>) {
    media.set_track(track);
}

#[tauri::command]
#[specta::specta]
pub fn media_set_volume(media: State<'_, MediaSession>, volume: f64) {
    media.set_volume(volume);
}

// -- Local library -----------------------------------------------------------

use crate::library::{CoverArt, Library, LocalLease, LocalTrack, ScanReport};

#[tauri::command]
#[specta::specta]
pub fn library_folders(library: State<'_, Library>) -> Result<Vec<String>, String> {
    library.folders().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn library_folder_cover(
    library: State<'_, Library>,
    path: String,
) -> Result<Option<CoverArt>, String> {
    library.folder_cover(&path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn library_add_folder(library: State<'_, Library>, path: String) -> Result<ScanReport, String> {
    let path = std::path::PathBuf::from(path);
    library.add_folder(&path).map_err(|e| e.to_string())?;
    // Scanning here rather than making the caller do it keeps "add a folder"
    // a single user-visible action that either works or reports why not.
    library.scan_folder(&path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn library_remove_folder(library: State<'_, Library>, path: String) -> Result<(), String> {
    library.remove_folder(&path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn library_scan(library: State<'_, Library>) -> Result<ScanReport, String> {
    library.scan_all().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn library_tracks(library: State<'_, Library>) -> Result<Vec<LocalTrack>, String> {
    library.tracks().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn library_search(
    library: State<'_, Library>,
    query: String,
) -> Result<Vec<LocalTrack>, String> {
    library.search(&query).map_err(|e| e.to_string())
}

/// The local half of stream resolution. Returns the same shape the YouTube
/// resolver will, so the frontend can treat the two interchangeably.
#[tauri::command]
#[specta::specta]
pub fn library_resolve(library: State<'_, Library>, id: String) -> Result<LocalLease, String> {
    library.resolve(&id).map_err(|e| e.to_string())
}

/// Opens a library folder in the file manager. Only folders in the library,
/// so the webview cannot open arbitrary paths. Async to keep the file
/// manager's D-Bus call off the main thread.
#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
pub fn account_cookie(account: State<'_, Account>) -> Option<String> {
    account.cookie()
}

/// Opens Google's sign-in and resolves once it completes. `None` means the user
/// closed the window, which is a cancel rather than an error. Google's cookies
/// from the last sign-in window go into this one, so it knows the device.
#[tauri::command]
#[specta::specta]
pub async fn account_sign_in<R: Runtime>(
    app: tauri::AppHandle<R>,
    account: State<'_, Account>,
) -> Result<Option<String>, String> {
    let device = account.session().map(|s| s.device).unwrap_or_default();
    let Some(signed_in) = sign_in::sign_in(&app, device).await? else {
        return Ok(None);
    };
    account.save(Session {
        cookie: signed_in.cookie.clone(),
        browser: None,
        device: signed_in.device,
    });
    Ok(Some(signed_in.cookie))
}

/// The browser profiles a session can be imported from.
#[tauri::command]
#[specta::specta]
pub async fn account_browsers() -> Result<Vec<import::Browser>, String> {
    tauri::async_runtime::spawn_blocking(import::browsers)
        .await
        .map_err(|error| error.to_string())
}

/// Takes the YouTube session from a browser profile listed by `account_browsers`.
#[tauri::command]
#[specta::specta]
pub async fn account_import(account: State<'_, Account>, id: String) -> Result<String, String> {
    let cookie = import_from(id.clone()).await?;
    account.save(Session {
        cookie: cookie.clone(),
        browser: Some(id),
        device: Vec::new(),
    });
    Ok(cookie)
}

/// A fresher copy of the session, once YouTube has stopped accepting `stale`,
/// the cookie the engine had. A rotation can land while a request with the
/// old copy is out, so a session saved since is the answer. Otherwise an
/// imported session is read again from its browser, which rotates the session
/// it shares with us, so its copy is the live one, and a sign-in window
/// session is rotated here. None when nothing gives anything newer.
#[tauri::command]
#[specta::specta]
pub async fn account_refresh(
    account: State<'_, Account>,
    stale: String,
) -> Result<Option<String>, String> {
    let Some(session) = account.session() else {
        return Ok(None);
    };
    if session.cookie != stale {
        return Ok(Some(session.cookie));
    }
    let Some(id) = session.browser.clone() else {
        return rotated(&account, session).await;
    };
    let cookie = import_from(id).await?;
    let session = Session {
        cookie: cookie.clone(),
        ..session
    };
    // Reading the browser can wait on a keyring prompt, long enough to sign
    // out or in again meanwhile.
    if cookie == stale || !account.replace(&stale, session) {
        return Ok(None);
    }
    Ok(Some(cookie))
}

/// Rotates a sign-in window session, which the app has to keep alive itself.
/// None for an imported session, which its browser keeps alive, or when the
/// rotation did not take.
#[tauri::command]
#[specta::specta]
pub async fn account_rotate(account: State<'_, Account>) -> Result<Option<String>, String> {
    match account.session() {
        Some(session) if session.browser.is_none() => rotated(&account, session).await,
        _ => Ok(None),
    }
}

async fn rotated(account: &Account, session: Session) -> Result<Option<String>, String> {
    let Some(fresh) = rotate::rotate(&session.cookie).await? else {
        return Ok(None);
    };
    let stale = session.cookie.clone();
    let session = Session {
        cookie: fresh.clone(),
        ..session
    };
    // Signed out or signed in again while the request was out.
    if !account.replace(&stale, session) {
        return Ok(None);
    }
    Ok(Some(fresh))
}

async fn import_from(id: String) -> Result<String, String> {
    // Reading the keyring can wait on an unlock prompt.
    tauri::async_runtime::spawn_blocking(move || import::import(&id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub fn account_sign_out(account: State<'_, Account>) -> Result<(), String> {
    account.clear()
}

#[tauri::command]
#[specta::specta]
pub fn settings_get(settings: State<'_, SettingsStore>) -> Settings {
    settings.get()
}

/// Changes the settings named in `patch`, applies the ones mpv owns, and
/// returns all of them.
#[tauri::command]
#[specta::specta]
pub fn settings_set<R: Runtime>(
    app: tauri::AppHandle<R>,
    settings: State<'_, SettingsStore>,
    patch: SettingsPatch,
) -> Result<Settings, String> {
    let next = settings.update(patch.to_json())?;
    if let Some(player) = app.try_state::<Player>() {
        player.apply_settings(&next);
    }
    crate::tray::sync(&app, next.close_to_tray);
    Ok(next)
}

/// The queue saved by the last run, and the playing song's position in it.
#[tauri::command]
#[specta::specta]
pub fn queue_load(store: State<'_, QueueStore>) -> SavedQueue {
    store.load()
}

/// Replaces the saved queue. Null clears it.
#[tauri::command]
#[specta::specta]
pub async fn queue_save(store: State<'_, QueueStore>, queue: QueueJson) -> Result<(), String> {
    store.save_queue(&queue.0)
}

#[tauri::command]
#[specta::specta]
pub async fn queue_save_position(
    store: State<'_, QueueStore>,
    position: QueuePosition,
) -> Result<(), String> {
    store.save_position(&position)
}

/// A release newer than this build, if there is one. Prereleases count when
/// the settings say so.
#[tauri::command]
#[specta::specta]
pub async fn update_check<R: Runtime>(
    app: tauri::AppHandle<R>,
    settings: State<'_, SettingsStore>,
) -> Result<Option<crate::updates::Update>, String> {
    let include_prereleases = settings.get().include_prereleases;
    crate::updates::check(&app.package_info().version, include_prereleases).await
}

/// Opens the folder `tauri-plugin-log` writes to, for attaching a log to a bug
/// report.
#[tauri::command]
#[specta::specta]
pub async fn open_logs_folder<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| e.to_string())
}

/// How many bytes the artwork cache takes on disk, the only cache with a size
/// worth showing.
#[tauri::command]
#[specta::specta]
pub async fn cache_size(images: State<'_, Images>) -> Result<u64, String> {
    let images = images.inner().clone();
    tauri::async_runtime::spawn_blocking(move || images.size())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Deletes the cached artwork and empties the webview's own memory and disk
/// caches, so the app fetches and draws as on a cold start. Cookies and
/// storage stay. The frontend drops its in-memory pages itself.
#[tauri::command]
#[specta::specta]
pub async fn cache_clear<R: Runtime>(
    app: tauri::AppHandle<R>,
    images: State<'_, Images>,
) -> Result<(), String> {
    let images = images.inner().clone();
    tauri::async_runtime::spawn_blocking(move || images.clear())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    if let Some(window) = app.get_webview_window("main") {
        clear_webview_cache(&window).await?;
    }
    Ok(())
}

/// Empties WebKitGTK's memory and disk caches and waits until it is done.
#[cfg(target_os = "linux")]
async fn clear_webview_cache<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    let (done, finished) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| {
            use webkit2gtk::{WebViewExt, WebsiteDataManagerExtManual, WebsiteDataTypes};
            let Some(manager) = webview.inner().website_data_manager() else {
                let _ = done.send(Ok(()));
                return;
            };
            // Caches only: cookies, local storage (ratings) and IndexedDB hold
            // user data and stay.
            let caches = WebsiteDataTypes::MEMORY_CACHE
                | WebsiteDataTypes::DISK_CACHE
                | WebsiteDataTypes::OFFLINE_APPLICATION_CACHE;
            // A timespan of 0 clears everything, however old.
            manager.clear(
                caches,
                webkit2gtk::glib::TimeSpan(0),
                None::<&webkit2gtk::gio::Cancellable>,
                move |result| {
                    let _ = done.send(result.map_err(|e| e.to_string()));
                },
            );
        })
        .map_err(|e| e.to_string())?;
    finished.await.map_err(|e| e.to_string())?
}

/// Windows: WebView2's `ClearBrowsingData` with the disk cache kind would do
/// it, but it needs `webview2-com` and `windows` as direct dependencies at the
/// versions wry uses, so it waits until it can be built and tried on Windows.
/// macOS has no build. Both keep their webview caches until the app restarts.
#[cfg(not(target_os = "linux"))]
async fn clear_webview_cache<R: Runtime>(_window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    Ok(())
}
