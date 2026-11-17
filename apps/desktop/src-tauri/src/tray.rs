//! "Keep playing in the tray": closing the window hides it, and a tray icon
//! brings it back, pauses, or quits.
//!
//! The icon only exists while the setting is on. On Linux it goes through
//! libayatana-appindicator, which the tray crate loads at run time and panics
//! without. Release builds abort on panic, so the library is probed before the
//! icon is built: a missing library costs the setting rather than the app.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime,
};

use crate::playback::Player;

const TRAY_ID: &str = "main";

/// Whether closing the window should hide it. Only while the icon is there to
/// bring it back.
pub fn keeps_playing<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

/// Adds or removes the icon to match the setting.
pub fn sync<R: Runtime>(app: &AppHandle<R>, on: bool) {
    match (on, keeps_playing(app)) {
        (true, false) => {
            if !has_tray_support() {
                tracing::error!(
                    "could not add the tray icon: no system tray support (on Linux, install \
                     libayatana-appindicator3-1)"
                );
                return;
            }
            if let Err(error) = build(app) {
                tracing::error!(%error, "could not add the tray icon");
            }
        }
        (false, true) => {
            app.remove_tray_by_id(TRAY_ID);
        }
        _ => {}
    }
}

/// Whether the tray crate will find an appindicator library. It tries these
/// names in this order (libappindicator-sys) and panics when none loads.
#[cfg(target_os = "linux")]
pub fn has_tray_support() -> bool {
    const LIBRARIES: [&std::ffi::CStr; 4] = [
        c"libayatana-appindicator3.so.1",
        c"libappindicator3.so.1",
        c"libayatana-appindicator3.so",
        c"libappindicator3.so",
    ];
    LIBRARIES.iter().any(|name| {
        // SAFETY: dlopen with a valid C string; the handle is closed straight away.
        let handle = unsafe { libc::dlopen(name.as_ptr(), libc::RTLD_LAZY) };
        if handle.is_null() {
            return false;
        }
        unsafe { libc::dlclose(handle) };
        true
    })
}

#[cfg(not(target_os = "linux"))]
pub fn has_tray_support() -> bool {
    true
}

fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show yMusic", true, None::<&str>)?;
    let play_pause = MenuItem::with_id(app, "play-pause", "Play/Pause", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &play_pause, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("yMusic")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_window(app),
            "play-pause" => {
                if let Some(player) = app.try_state::<Player>() {
                    if let Err(error) = player.toggle_pause() {
                        tracing::warn!("{error}");
                    }
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Shows the window if no tray host turns up to draw the icon. Building the
/// icon only proves the library loaded: stock GNOME without the AppIndicator
/// extension has no host, and at login the host may start after the app. The
/// host owns `org.kde.StatusNotifierWatcher` on the session bus, so this waits
/// up to ten seconds for that name. A desktop with only an older XEmbed tray
/// gets the window too, which is the safe side to err on.
#[cfg(target_os = "linux")]
pub fn show_window_without_host<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        if !wait_for_host(std::time::Duration::from_secs(10)) {
            tracing::warn!("no tray host showed up, so the window is shown instead");
            show_window(&app);
        }
    });
}

#[cfg(not(target_os = "linux"))]
pub fn show_window_without_host<R: Runtime>(_app: &AppHandle<R>) {}

#[cfg(target_os = "linux")]
fn wait_for_host(timeout: std::time::Duration) -> bool {
    let connection = match zbus::blocking::Connection::session() {
        Ok(connection) => connection,
        Err(error) => {
            tracing::warn!(%error, "no session bus to look for a tray host on");
            return false;
        }
    };
    let Ok(bus) = zbus::blocking::fdo::DBusProxy::new(&connection) else {
        return false;
    };
    let Ok(watcher) = zbus::names::BusName::try_from("org.kde.StatusNotifierWatcher") else {
        return false;
    };
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if bus.name_has_owner(watcher.clone()).unwrap_or(false) {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
}

/// Shows the main window, unless setup has not shown it yet: it is still
/// starting, and focuses it once it shows, or mpv failed and it stays hidden
/// behind the error dialog.
pub fn show_window<R: Runtime>(app: &AppHandle<R>) {
    if !crate::platform::window::may_show() {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
