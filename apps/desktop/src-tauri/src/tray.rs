//! "Keep playing in the tray": closing the window hides it, and a tray icon
//! brings it back, pauses, or quits.
//!
//! The icon only exists while the setting is on. On Linux it goes through
//! libayatana-appindicator, which the tray crate loads at run time and panics
//! without, so a missing library costs the setting rather than the app.

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
            let built = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| build(app)));
            match built {
                Ok(Ok(())) => {}
                Ok(Err(error)) => log::error!("could not add the tray icon: {error}"),
                Err(_) => log::error!(
                    "could not add the tray icon: no system tray support (on Linux, install \
                     libayatana-appindicator3-1)"
                ),
            }
        }
        (false, true) => {
            app.remove_tray_by_id(TRAY_ID);
        }
        _ => {}
    }
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
                        log::warn!("{error}");
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

pub fn show_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
