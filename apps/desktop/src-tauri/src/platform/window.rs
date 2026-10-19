//! Window chrome and placement. Mica on Windows; on Linux the webview keeps the
//! flat themed surface the stylesheet paints, because there is no portable
//! vibrancy. Also how a touchpad pinch reaches the page.

use tauri::{PhysicalPosition, PhysicalRect, PhysicalSize, WebviewWindow};
use tauri_plugin_window_state::StateFlags;

/// What the window-state plugin saves and restores. Visibility stays out: with
/// "Keep playing in the tray" the window is often hidden when the app quits,
/// and a launch should always show it. Decorations are always off (the title
/// bar is ours) and there is no fullscreen mode.
pub const SAVED_STATE: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED);

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
            log::debug!("mica unavailable, falling back to a solid background: {error}");
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

/// Moves the window back onto a screen when the restored position leaves its
/// title bar on none, which happens when the monitor it was on is gone. The
/// plugin only checks that one corner of the window lands on a monitor.
pub fn keep_on_screen(window: &WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        return;
    }
    let (Ok(position), Ok(size), Ok(monitors)) = (
        window.outer_position(),
        window.outer_size(),
        window.available_monitors(),
    ) else {
        return;
    };
    let target = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.first().cloned());
    let Some(target) = target else {
        return;
    };
    let title_bar = (TITLE_BAR_HEIGHT * window.scale_factor().unwrap_or(1.0)) as u32;
    let screens: Vec<PhysicalRect<i32, u32>> = monitors
        .iter()
        .map(|monitor| *monitor.work_area())
        .collect();
    if let Some((position, size)) =
        placement(position, size, title_bar, &screens, target.work_area())
    {
        log::info!("the saved window position is off screen, centring it");
        let _ = window.set_size(size);
        let _ = window.set_position(position);
    }
}

/// Where to put a window whose title bar is on none of `screens`, or `None` to
/// leave it. It goes in the middle of `target`, shrunk to fit if it is bigger.
fn placement(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    title_bar: u32,
    screens: &[PhysicalRect<i32, u32>],
    target: &PhysicalRect<i32, u32>,
) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let centre = PhysicalPosition {
        x: position.x + (size.width / 2) as i32,
        y: position.y + (title_bar.min(size.height) / 2) as i32,
    };
    if screens.iter().any(|screen| contains(screen, centre)) {
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

    const SIZE: PhysicalSize<u32> = PhysicalSize {
        width: 1100,
        height: 720,
    };

    #[test]
    fn leaves_a_window_whose_title_bar_is_on_a_screen() {
        let screens = [rect(0, 0, 1920, 1080), rect(1920, 0, 2560, 1440)];
        let at = PhysicalPosition { x: 2400, y: 200 };
        assert_eq!(placement(at, SIZE, 32, &screens, &screens[0]), None);
    }

    #[test]
    fn centres_a_window_left_on_a_monitor_that_is_gone() {
        let laptop = rect(0, 0, 1920, 1080);
        let at = PhysicalPosition { x: 2400, y: 200 };
        let (position, size) = placement(at, SIZE, 32, &[laptop], &laptop).unwrap();
        assert_eq!(size, SIZE);
        assert_eq!(position, PhysicalPosition { x: 410, y: 180 });
    }

    #[test]
    fn centres_a_window_with_only_a_corner_on_a_screen() {
        // The bottom-left corner pokes onto the screen, which is enough for
        // the plugin, but the title bar is above the top edge.
        let laptop = rect(0, 0, 1920, 1080);
        let at = PhysicalPosition { x: 1000, y: -700 };
        assert!(placement(at, SIZE, 32, &[laptop], &laptop).is_some());
    }

    #[test]
    fn shrinks_a_window_bigger_than_the_screen_it_moves_to() {
        let small = rect(0, 0, 1280, 680);
        let big = PhysicalSize {
            width: 2400,
            height: 1300,
        };
        let at = PhysicalPosition { x: -2400, y: 0 };
        let (position, size) = placement(at, big, 32, &[small], &small).unwrap();
        assert_eq!(
            size,
            PhysicalSize {
                width: 1280,
                height: 680
            }
        );
        assert_eq!(position, PhysicalPosition { x: 0, y: 0 });
    }
}
