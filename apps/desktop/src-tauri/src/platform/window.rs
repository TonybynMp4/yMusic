//! Window chrome. Mica on Windows; on Linux the webview keeps the flat themed
//! surface the stylesheet paints, because there is no portable vibrancy.

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
