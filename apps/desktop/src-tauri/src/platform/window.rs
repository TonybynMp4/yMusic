//! Window chrome and placement. Mica on Windows; on Linux the webview keeps the
//! flat themed surface the stylesheet paints, because there is no portable
//! vibrancy. Also how a touchpad pinch reaches the page.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalRect, PhysicalSize, Runtime, WebviewWindow,
};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// What the window-state plugin saves and restores. Visibility stays out: with
/// "Keep playing in the tray" the window is often hidden when the app quits,
/// and a launch should always show it. Decorations are always off (the title
/// bar is ours) and there is no fullscreen mode. Position stays out on
/// Wayland, where the window always reads (0, 0) and cannot move itself:
/// saving it there would overwrite a real position saved under X11.
pub fn saved_state() -> StateFlags {
    let mut state = StateFlags::SIZE | StateFlags::MAXIMIZED;
    if !is_wayland() {
        state |= StateFlags::POSITION;
    }
    state
}

/// Writes the window's state now rather than only on a clean exit, which a
/// logout, a kill or a crash skips. Called on every focus loss, so it only
/// writes when the window has moved, resized or (un)maximized since.
pub fn save_state(window: &tauri::Window) {
    type Geometry = (PhysicalSize<u32>, PhysicalPosition<i32>, bool);
    static LAST_SAVED: Mutex<Option<Geometry>> = Mutex::new(None);

    let (Ok(size), Ok(position), Ok(maximized)) = (
        window.inner_size(),
        window.outer_position(),
        window.is_maximized(),
    ) else {
        return;
    };
    let geometry = Some((size, position, maximized));
    let mut last = LAST_SAVED.lock().expect("window geometry mutex");
    if *last == geometry {
        return;
    }
    match window.app_handle().save_window_state(saved_state()) {
        Ok(()) => *last = geometry,
        Err(error) => tracing::warn!("could not save the window state: {error}"),
    }
}

/// Whether GTK opens its windows on Wayland. Worked out once from the
/// environment the way GDK does it, because the plugin is built before GTK
/// starts.
#[cfg(target_os = "linux")]
fn is_wayland() -> bool {
    static IS_WAYLAND: OnceLock<bool> = OnceLock::new();
    *IS_WAYLAND.get_or_init(|| {
        let display = std::env::var("WAYLAND_DISPLAY").ok();
        let runtime_dir = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from);
        let backend = std::env::var("GDK_BACKEND").ok();
        // GDK falls back to X11 when it cannot connect, as it does with a
        // `WAYLAND_DISPLAY` left over from another session.
        wayland_first(backend.as_deref())
            && wayland_socket(display.as_deref(), runtime_dir.as_deref())
                .is_some_and(|socket| std::os::unix::net::UnixStream::connect(socket).is_ok())
    })
}

#[cfg(not(target_os = "linux"))]
fn is_wayland() -> bool {
    false
}

/// GDK tries the backends in `GDK_BACKEND` in order, and Wayland first when it
/// is unset or `*`.
fn wayland_first(gdk_backend: Option<&str>) -> bool {
    let first = gdk_backend.and_then(|list| list.split(',').map(str::trim).find(|b| !b.is_empty()));
    matches!(first, None | Some("wayland" | "*"))
}

/// The socket libwayland connects to: `WAYLAND_DISPLAY`, or `wayland-0` when
/// it is unset, under `XDG_RUNTIME_DIR` unless it is absolute. GDK does not
/// try Wayland at all without `XDG_RUNTIME_DIR`.
fn wayland_socket(display: Option<&str>, runtime_dir: Option<&Path>) -> Option<PathBuf> {
    let runtime_dir = runtime_dir?;
    let display = display.unwrap_or("wayland-0");
    if display.is_empty() {
        return None;
    }
    Some(runtime_dir.join(display))
}

/// The main window's entry in the plugin's file, as far as placing it goes.
/// `width` and `height` are the inner size. For a maximized window they are
/// the size it un-maximizes to, and `prev_x` and `prev_y` the position.
#[derive(Deserialize)]
struct SavedWindow {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    #[serde(default)]
    prev_x: i32,
    #[serde(default)]
    prev_y: i32,
    #[serde(default)]
    maximized: bool,
}

fn read_saved<R: Runtime>(app: &AppHandle<R>) -> Option<SavedWindow> {
    let path = app.path().app_config_dir().ok()?.join(app.filename());
    let mut windows: HashMap<String, SavedWindow> =
        serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    windows.remove("main")
}

/// Whether setup has shown the main window, and whether anything asked to
/// show it before then. Until setup shows it nothing else may: the page would
/// find its state missing.
struct Startup {
    shown: bool,
    requested: bool,
    /// Whether the window has been on screen at all. A login launch into the
    /// tray ends setup with it still hidden.
    on_screen: bool,
}

static STARTUP: Mutex<Startup> = Mutex::new(Startup {
    shown: false,
    requested: false,
    on_screen: false,
});

/// Ends setup's hold on the main window: from here on others may show it.
/// Shows it when `visible` (false for a login launch into the tray), and
/// shows and focuses it when a second launch, the tray or the media controls
/// asked for it while setup ran.
pub fn reveal(window: &WebviewWindow, visible: bool) {
    let requested = {
        let mut startup = STARTUP.lock().expect("startup mutex");
        startup.shown = true;
        startup.on_screen |= visible || startup.requested;
        startup.requested
    };
    if visible || requested {
        let _ = window.show();
    }
    if requested {
        let _ = window.set_focus();
    }
}

/// Whether setup has shown the main window, so others may show it too. Before
/// then the request is kept for `reveal`. A yes counts as the window going on
/// screen, since the caller shows it next.
pub fn may_show() -> bool {
    let mut startup = STARTUP.lock().expect("startup mutex");
    startup.requested |= !startup.shown;
    startup.on_screen |= startup.shown;
    startup.shown
}

/// Closes a main window that was never on screen, on the way out. The
/// window-state plugin saves every open window when the app exits, and one
/// that never showed would write its creation-time geometry over where the
/// user last left it. A closed window is skipped, and its saved state stays.
pub fn forget_unshown<R: Runtime>(app: &AppHandle<R>) {
    if STARTUP.lock().expect("startup mutex").on_screen {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.destroy();
    }
}

/// How much of the top of the window has to be on a screen to count as
/// reachable: the custom title bar's height, the part you drag it by. Keep it
/// in step with `h-8` in `src/TitleBar.tsx`.
const TITLE_BAR_HEIGHT: f64 = 32.0;

pub fn apply_backdrop(window: &WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        // Mica needs Windows 11 build 22000+. Older builds keep the solid
        // background, which looks plain but is not broken.
        if let Err(error) = window_vibrancy::apply_mica(window, Some(true)) {
            tracing::debug!(%error, "mica unavailable, falling back to a solid background");
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
    }
}

/// Hands a touchpad pinch to the page instead of letting it zoom the page.
///
/// Chromium (WebView2 on Windows) already reports a pinch to the page as a
/// wheel event with Ctrl held. WebKitGTK reports nothing and scales the whole
/// view instead, so on Linux the pinch is taken from GTK before WebKit sees it
/// and dispatched on `window` as a `touchpadpinch` event whose `detail` is the
/// scale since the pinch began (1 at its start).
pub fn forward_touchpad_pinch(window: &WebviewWindow) {
    #[cfg(target_os = "linux")]
    {
        use gtk::gdk::{EventTouchpadPinch, EventType};
        use gtk::prelude::*;
        use webkit2gtk::{gio, glib, WebViewExt};

        let _ = window.with_webview(|webview| {
            // WebKit zooms from its widget's own event handler, which a
            // handler connected here runs before and can stop.
            webview.inner().connect_event(|view, event| {
                if event.event_type() != EventType::TouchpadPinch {
                    return glib::Propagation::Proceed;
                }
                if let Some(pinch) = event.downcast_ref::<EventTouchpadPinch>() {
                    let script = format!(
                        "window.dispatchEvent(new CustomEvent('touchpadpinch', {{ detail: {} }}))",
                        pinch.scale()
                    );
                    view.evaluate_javascript(
                        &script,
                        None,
                        None,
                        None::<&gio::Cancellable>,
                        |_| {},
                    );
                }
                glib::Propagation::Stop
            });
        });
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
    }
}

/// Moves the window back onto a screen when its saved position leaves its
/// title bar on none, which happens when the monitor it was on is gone. The
/// plugin only checks that one corner of the window lands on a monitor, and
/// for a maximized window it checks the maximized corner but restores the
/// position it un-maximizes to, which it does not check at all.
///
/// It works from the saved state, not the window: on Linux the plugin's moves
/// are still queued at this point, and a window that has never been mapped
/// reads its creation-time geometry. Its own moves queue behind the plugin's.
pub fn keep_on_screen(window: &WebviewWindow) {
    // Wayland reports no position to check, and ignores one set.
    if is_wayland() {
        return;
    }
    let Some(saved) = read_saved(window.app_handle()) else {
        return;
    };
    if saved.width == 0 || saved.height == 0 {
        return;
    }
    let Ok(monitors) = window.available_monitors() else {
        return;
    };
    let Some(target) = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.first().cloned())
    else {
        return;
    };
    let size = PhysicalSize::new(saved.width, saved.height);
    let position = if saved.maximized {
        PhysicalPosition::new(saved.prev_x, saved.prev_y)
    } else {
        PhysicalPosition::new(saved.x, saved.y)
    };
    // The whole monitor, not its work area: a title bar under a panel the
    // window manager lets windows overlap is still on screen. Each with its
    // own scale, which sets how tall the title bar is there.
    let screens = monitors.iter().map(|monitor| Screen {
        bounds: PhysicalRect {
            position: *monitor.position(),
            size: *monitor.size(),
        },
        title_bar: (TITLE_BAR_HEIGHT * monitor.scale_factor()) as u32,
    });
    let Some((position, fitted)) = placement(position, size, screens, target.work_area()) else {
        return;
    };
    tracing::info!("the saved window position is off screen, centring it");
    // A maximized window takes the new place as the one it un-maximizes to.
    if saved.maximized {
        let _ = window.unmaximize();
    }
    if fitted != size {
        let _ = window.set_size(fitted);
    }
    let _ = window.set_position(position);
    if saved.maximized {
        let _ = window.maximize();
    }
}

/// A monitor, and the height of the title bar on it.
struct Screen {
    bounds: PhysicalRect<i32, u32>,
    title_bar: u32,
}

/// Where to put a window whose title bar is on none of `screens`, or `None` to
/// leave it. It goes in the middle of `target`, shrunk to fit if it is bigger.
fn placement(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    screens: impl IntoIterator<Item = Screen>,
    target: &PhysicalRect<i32, u32>,
) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let on_screen = screens.into_iter().any(|screen| {
        let centre = PhysicalPosition {
            x: position.x + (size.width / 2) as i32,
            y: position.y + (screen.title_bar.min(size.height) / 2) as i32,
        };
        contains(&screen.bounds, centre)
    });
    if on_screen {
        return None;
    }
    let size = PhysicalSize {
        width: size.width.min(target.size.width),
        height: size.height.min(target.size.height),
    };
    let position = PhysicalPosition {
        x: target.position.x + ((target.size.width - size.width) / 2) as i32,
        y: target.position.y + ((target.size.height - size.height) / 2) as i32,
    };
    Some((position, size))
}

fn contains(rect: &PhysicalRect<i32, u32>, point: PhysicalPosition<i32>) -> bool {
    let (x, y) = (i64::from(point.x), i64::from(point.y));
    let (left, top) = (i64::from(rect.position.x), i64::from(rect.position.y));
    x >= left
        && y >= top
        && x < left + i64::from(rect.size.width)
        && y < top + i64::from(rect.size.height)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: u32, height: u32) -> PhysicalRect<i32, u32> {
        PhysicalRect {
            position: PhysicalPosition { x, y },
            size: PhysicalSize { width, height },
        }
    }

    fn screen(x: i32, y: i32, width: u32, height: u32) -> Screen {
        Screen {
            bounds: rect(x, y, width, height),
            title_bar: 32,
        }
    }

    const SIZE: PhysicalSize<u32> = PhysicalSize {
        width: 1100,
        height: 720,
    };

    #[test]
    fn tries_wayland_first_the_way_gdk_does() {
        assert!(wayland_first(None));
        assert!(wayland_first(Some("wayland,x11")));
        assert!(wayland_first(Some("*")));
        assert!(!wayland_first(Some("x11")));
        assert!(!wayland_first(Some("x11,wayland")));
    }

    #[test]
    fn finds_the_socket_libwayland_connects_to() {
        let run = Path::new("/run/user/1000");
        assert_eq!(
            wayland_socket(Some("wayland-1"), Some(run)),
            Some(run.join("wayland-1"))
        );
        assert_eq!(wayland_socket(None, Some(run)), Some(run.join("wayland-0")));
        assert_eq!(
            wayland_socket(Some("/tmp/wl"), Some(run)),
            Some(PathBuf::from("/tmp/wl"))
        );
        assert_eq!(wayland_socket(Some(""), Some(run)), None);
        assert_eq!(wayland_socket(Some("wayland-0"), None), None);
    }

    #[test]
    fn leaves_a_window_whose_title_bar_is_on_a_screen() {
        let screens = [screen(0, 0, 1920, 1080), screen(1920, 0, 2560, 1440)];
        let at = PhysicalPosition { x: 2400, y: 200 };
        let target = rect(0, 0, 1920, 1080);
        assert_eq!(placement(at, SIZE, screens, &target), None);
    }

    #[test]
    fn centres_a_window_left_on_a_monitor_that_is_gone() {
        let laptop = rect(0, 0, 1920, 1080);
        let at = PhysicalPosition { x: 2400, y: 200 };
        let (position, size) = placement(at, SIZE, [screen(0, 0, 1920, 1080)], &laptop).unwrap();
        assert_eq!(size, SIZE);
        assert_eq!(position, PhysicalPosition { x: 410, y: 180 });
    }

    #[test]
    fn centres_a_window_with_only_a_corner_on_a_screen() {
        // The bottom-left corner pokes onto the screen, which is enough for
        // the plugin, but the title bar is above the top edge.
        let laptop = rect(0, 0, 1920, 1080);
        let at = PhysicalPosition { x: 1000, y: -700 };
        assert!(placement(at, SIZE, [screen(0, 0, 1920, 1080)], &laptop).is_some());
    }

    #[test]
    fn shrinks_a_window_bigger_than_the_screen_it_moves_to() {
        let small = rect(0, 0, 1280, 680);
        let big = PhysicalSize {
            width: 2400,
            height: 1300,
        };
        let at = PhysicalPosition { x: -2400, y: 0 };
        let (position, size) = placement(at, big, [screen(0, 0, 1280, 680)], &small).unwrap();
        assert_eq!(
            size,
            PhysicalSize {
                width: 1280,
                height: 680
            }
        );
        assert_eq!(position, PhysicalPosition { x: 0, y: 0 });
    }

    #[test]
    fn leaves_a_title_bar_under_a_top_panel() {
        // The work area starts below a 40px panel; the monitor does not.
        let screens = [screen(0, 0, 1920, 1080)];
        let work_area = rect(0, 40, 1920, 1040);
        let at = PhysicalPosition { x: 400, y: 0 };
        assert_eq!(placement(at, SIZE, screens, &work_area), None);
    }

    #[test]
    fn measures_the_title_bar_on_each_screen() {
        // The middle of a 64px title bar at y = -20 is on screen; the middle
        // of a 32px one is not.
        let at = PhysicalPosition { x: 400, y: -20 };
        let target = rect(0, 0, 1920, 1080);
        let hidpi = Screen {
            bounds: target,
            title_bar: 64,
        };
        assert_eq!(placement(at, SIZE, [hidpi], &target), None);
        assert!(placement(at, SIZE, [screen(0, 0, 1920, 1080)], &target).is_some());
    }
}
