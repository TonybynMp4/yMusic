//! Window chrome. Mica on Windows; on Linux the webview keeps the flat themed
//! surface the stylesheet paints, because there is no portable vibrancy. Also
//! how a touchpad pinch reaches the page.

use tauri::WebviewWindow;

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
