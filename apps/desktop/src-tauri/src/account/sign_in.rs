//! Signing in through a Google page in an app-owned window.
//!
//! OAuth is not an option here. YouTube's InnerTube only accepts OAuth tokens
//! from its own TV client, whose flow is a device code typed into
//! google.com/device with no redirect to catch, and whose tokens YouTube began
//! refusing in late 2024. yt-dlp dropped that path for the same reason. What
//! every working third-party client uses instead is the browser session's
//! cookies, so that is what this collects: the user signs in on Google's own
//! page, and once it lands on YouTube Music the window's cookies are read back.
//!
//! The window is incognito, so its cookies never reach a persistent profile
//! (the only copy is the sealed one `Account` keeps), and it has no capability,
//! so the remote page gets no IPC.

use std::sync::mpsc;
use tauri::{
    webview::{Cookie, PageLoadEvent},
    AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

pub const WINDOW_LABEL: &str = "sign-in";

const SIGN_IN_URL: &str = "https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=https%3A%2F%2Fmusic.youtube.com%2F";
const MUSIC_URL: &str = "https://music.youtube.com/";

/// Google turns away sign-ins from browsers it does not recognise, and
/// WebKitGTK's own user agent, "Safari" but on Linux, is one of them. This is
/// the same engine's desktop identity. WebView2 already presents itself as
/// Edge, which Google accepts, so Windows keeps its own.
#[cfg(target_os = "linux")]
const USER_AGENT: Option<&str> = Some(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
     (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
);
#[cfg(not(target_os = "linux"))]
const USER_AGENT: Option<&str> = None;

enum Step {
    Landed,
    Closed,
}

/// Opens the sign-in window and waits. `Ok(None)` means the user closed it.
pub async fn sign_in<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>, String> {
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        let _ = existing.set_focus();
        return Err("sign-in is already open".into());
    }

    let (tx, rx) = mpsc::channel();
    let landed = tx.clone();
    let mut builder = WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        WebviewUrl::External(SIGN_IN_URL.parse().expect("a valid URL")),
    )
    .title("Sign in to YouTube Music")
    .inner_size(460.0, 700.0)
    .incognito(true)
    .on_page_load(move |_, payload| {
        if payload.event() == PageLoadEvent::Finished && is_music(payload.url()) {
            let _ = landed.send(Step::Landed);
        }
    });
    if let Some(agent) = USER_AGENT {
        builder = builder.user_agent(agent);
    }
    let window = builder
        .build()
        .map_err(|error| format!("could not open sign-in: {error}"))?;
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            let _ = tx.send(Step::Closed);
        }
    });

    // Blocking on the channel, and reading cookies, both belong off the async
    // runtime: WebView2's cookie call can deadlock a thread the webview needs.
    tauri::async_runtime::spawn_blocking(move || loop {
        match rx.recv() {
            Ok(Step::Landed) => {
                let cookies = window
                    .cookies_for_url(MUSIC_URL.parse().expect("a valid URL"))
                    .map_err(|error| format!("could not read the session: {error}"))?;
                // Landing on YouTube Music signed out ("skip" on some Google
                // prompts does that) is not a sign-in. Keep the window open.
                if let Some(header) = cookie_header(&cookies) {
                    let _ = window.destroy();
                    return Ok(Some(header));
                }
            }
            Ok(Step::Closed) | Err(_) => return Ok(None),
        }
    })
    .await
    .map_err(|error| format!("sign-in stopped unexpectedly: {error}"))?
}

fn is_music(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some("music.youtube.com")
}

/// The cookies as one `Cookie` header, or None if they are not a signed-in
/// session. `SAPISID` is the test because it is the one youtubei.js hashes
/// into the `Authorization` header; without it the rest are decoration.
pub fn cookie_header(cookies: &[Cookie<'_>]) -> Option<String> {
    let signed_in = cookies
        .iter()
        .any(|c| matches!(c.name(), "SAPISID" | "__Secure-3PAPISID") && !c.value().is_empty());
    if !signed_in {
        return None;
    }
    let pairs: Vec<String> = cookies
        .iter()
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect();
    Some(pairs.join("; "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_needs_sapisid() {
        let anonymous = [
            Cookie::new("VISITOR_INFO1_LIVE", "v"),
            Cookie::new("YSC", "y"),
        ];
        assert_eq!(cookie_header(&anonymous), None);

        let signed_in = [
            Cookie::new("YSC", "y"),
            Cookie::new("__Secure-3PAPISID", "a/b"),
        ];
        assert_eq!(
            cookie_header(&signed_in).as_deref(),
            Some("YSC=y; __Secure-3PAPISID=a/b")
        );

        assert_eq!(cookie_header(&[Cookie::new("SAPISID", "")]), None);
    }

    #[test]
    fn only_youtube_music_counts_as_landing() {
        assert!(is_music(&"https://music.youtube.com/".parse().unwrap()));
        assert!(!is_music(&"https://accounts.google.com/".parse().unwrap()));
        assert!(!is_music(
            &"https://music.youtube.com.evil.test/".parse().unwrap()
        ));
        assert!(!is_music(&"http://music.youtube.com/".parse().unwrap()));
    }
}
