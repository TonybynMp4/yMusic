//! Whether the main window is hidden in the tray, and the one place that
//! hides and shows it.
//!
//! The page keeps running while the window is hidden, because the queue lives
//! there. It is told over a channel so it can stop the work only a visible
//! window needs. The webview's own `visibilitychange` is not relied on: what a
//! hidden window reports differs between WebKitGTK and WebView2.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, Runtime};

const MAIN_WINDOW: &str = "main";

/// What the page is told when the main window is hidden or shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Visibility {
    Shown,
    Hidden,
}

#[derive(Default)]
struct State {
    hidden: bool,
    page: Option<Channel<Visibility>>,
}

/// The main window's visibility, as last set through [`hide`] and [`show`].
#[derive(Default)]
pub struct WindowVisibility {
    state: Mutex<State>,
}

impl WindowVisibility {
    /// Replaces the page's channel. A page that subscribes while the window is
    /// hidden (a reload in the tray) is told so at once; shown is what it
    /// assumes until then.
    pub fn subscribe(&self, channel: Channel<Visibility>) {
        let mut state = self.lock();
        if state.hidden {
            send(&channel, Visibility::Hidden);
        }
        state.page = Some(channel);
    }

    pub fn is_hidden(&self) -> bool {
        self.lock().hidden
    }

    /// Records the change and tells the page, once per change: showing a
    /// window that is already there (a second launch) sends nothing.
    fn set(&self, hidden: bool) {
        let mut state = self.lock();
        if state.hidden == hidden {
            return;
        }
        state.hidden = hidden;
        if let Some(channel) = state.page.as_ref() {
            let visibility = if hidden {
                Visibility::Hidden
            } else {
                Visibility::Shown
            };
            send(channel, visibility);
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().expect("window visibility mutex")
    }
}

fn send(channel: &Channel<Visibility>, visibility: Visibility) {
    if let Err(error) = channel.send(visibility) {
        log::warn!("could not tell the page the window is {visibility:?}: {error}");
    }
}

/// Hides the main window in the tray.
pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let _ = window.hide();
    if let Some(visibility) = app.try_state::<WindowVisibility>() {
        visibility.set(true);
    }
}

/// Brings the main window back and to the front, hidden or minimized. The
/// page is told first, so it has started drawing by the time the window is up.
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    if let Some(visibility) = app.try_state::<WindowVisibility>() {
        visibility.set(false);
    }
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tauri::ipc::InvokeResponseBody;

    use super::*;

    /// A channel that records what it was sent, as the JSON the page gets.
    fn recording() -> (Channel<Visibility>, Arc<Mutex<Vec<String>>>) {
        let sent = Arc::new(Mutex::new(Vec::new()));
        let sink = sent.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                sink.lock().expect("sink").push(json);
            }
            Ok(())
        });
        (channel, sent)
    }

    fn sent(log: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
        log.lock().expect("sink").clone()
    }

    #[test]
    fn tells_the_page_once_per_change() {
        let visibility = WindowVisibility::default();
        let (channel, log) = recording();
        visibility.subscribe(channel);
        assert!(sent(&log).is_empty(), "shown is what the page assumes");

        visibility.set(false);
        visibility.set(true);
        visibility.set(true);
        visibility.set(false);
        visibility.set(false);
        assert_eq!(sent(&log), ["\"hidden\"", "\"shown\""]);
    }

    #[test]
    fn a_page_that_subscribes_while_hidden_is_told() {
        let visibility = WindowVisibility::default();
        visibility.set(true);
        assert!(visibility.is_hidden());

        let (channel, log) = recording();
        visibility.subscribe(channel);
        assert_eq!(sent(&log), ["\"hidden\""]);
    }

    #[test]
    fn a_new_subscription_replaces_the_old_one() {
        let visibility = WindowVisibility::default();
        let (first, first_log) = recording();
        let (second, second_log) = recording();
        visibility.subscribe(first);
        visibility.subscribe(second);
        visibility.set(true);
        assert!(sent(&first_log).is_empty());
        assert_eq!(sent(&second_log), ["\"hidden\""]);
    }

    #[test]
    fn hide_and_show_record_the_state() {
        let app = tauri::test::mock_app();
        app.manage(WindowVisibility::default());
        tauri::WebviewWindowBuilder::new(&app, MAIN_WINDOW, Default::default())
            .build()
            .expect("mock window");
        let state = app.state::<WindowVisibility>();

        hide(app.handle());
        assert!(state.is_hidden());
        show(app.handle());
        assert!(!state.is_hidden());
    }
}
