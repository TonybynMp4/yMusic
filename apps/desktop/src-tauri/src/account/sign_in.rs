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
//! so the remote page gets no IPC. Being incognito, it would also look like a
//! new device to Google every time, so Google's own long-lived cookies are
//! kept with the session (`DeviceCookie`) and put back before the next one
//! opens: Google then remembers the account and skips the checks it already
//! passed on this device.

use std::sync::mpsc;
use tauri::{
    webview::{
        cookie::{time::OffsetDateTime, SameSite},
        Cookie, PageLoadEvent,
    },
    AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

pub const WINDOW_LABEL: &str = "sign-in";

const SIGN_IN_URL: &str = "https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=https%3A%2F%2Fmusic.youtube.com%2F";
const MUSIC_URL: &str = "https://music.youtube.com/";
const GOOGLE_URL: &str = "https://accounts.google.com/";
const GOOGLE_HOST: &str = "accounts.google.com";

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

/// A finished sign-in: YouTube's cookie header, and Google's cookies to put
/// back next time.
pub struct SignedIn {
    pub cookie: String,
    pub device: Vec<DeviceCookie>,
}

/// One of the cookies Google set on `accounts.google.com`, with what it takes
/// to set it again. Only the ones with an expiry are kept: a browser drops the
/// rest when it closes, so they are not what makes it a known device.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DeviceCookie {
    name: String,
    value: String,
    /// Without its leading dot, the way the cookie crate hands it out.
    domain: Option<String>,
    path: Option<String>,
    secure: bool,
    http_only: bool,
    same_site: Option<String>,
    /// Unix seconds.
    expires: i64,
}

/// Opens the sign-in window, with `device` set in it first, and waits.
/// `Ok(None)` means the user closed it.
pub async fn sign_in<R: Runtime>(
    app: &AppHandle<R>,
    device: Vec<DeviceCookie>,
) -> Result<Option<SignedIn>, String> {
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        let _ = existing.set_focus();
        return Err("sign-in is already open".into());
    }

    let (tx, rx) = mpsc::channel();
    let landed = tx.clone();
    // Blank first, so the device cookies are in place before Google's page
    // asks for them.
    let mut builder = WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        WebviewUrl::External("about:blank".parse().expect("a valid URL")),
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
    tauri::async_runtime::spawn_blocking(move || {
        let restore = restore(&device, OffsetDateTime::now_utc().unix_timestamp());
        let names: Vec<&str> = restore.iter().map(|c| c.name()).collect();
        log::info!("sign-in: restoring Google cookies {names:?}");
        for cookie in restore {
            if let Err(error) = window.set_cookie(cookie.clone()) {
                log::warn!("sign-in: could not restore {}: {error}", cookie.name());
            }
        }
        if let Err(error) = window.navigate(SIGN_IN_URL.parse().expect("a valid URL")) {
            // Closed while the cookies were going in: a cancel, not a failure.
            if matches!(rx.try_recv(), Ok(Step::Closed)) {
                return Ok(None);
            }
            // A blank window left open would refuse every later sign-in.
            let _ = window.destroy();
            return Err(format!("could not open sign-in: {error}"));
        }

        loop {
            match rx.recv() {
                Ok(Step::Landed) => {
                    let cookies = window
                        .cookies_for_url(MUSIC_URL.parse().expect("a valid URL"))
                        .map_err(|error| format!("could not read the session: {error}"))?;
                    // Landing on YouTube Music signed out ("skip" on some Google
                    // prompts does that) is not a sign-in. Keep the window open.
                    let Some(cookie) = cookie_header(&cookies) else {
                        continue;
                    };
                    // Not having them only costs the next sign-in its shortcut.
                    let google = window
                        .cookies_for_url(GOOGLE_URL.parse().expect("a valid URL"))
                        .unwrap_or_default();
                    let device = keep(&google);
                    let names: Vec<&str> = device.iter().map(|c| c.name.as_str()).collect();
                    log::info!("sign-in: keeping Google cookies {names:?}");
                    let _ = window.destroy();
                    return Ok(Some(SignedIn { cookie, device }));
                }
                Ok(Step::Closed) | Err(_) => return Ok(None),
            }
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

/// The cookies from `accounts.google.com` worth keeping: those that would
/// outlive a browser restart.
pub fn keep(cookies: &[Cookie<'_>]) -> Vec<DeviceCookie> {
    cookies
        .iter()
        .filter_map(|c| {
            Some(DeviceCookie {
                name: c.name().into(),
                value: c.value().into(),
                domain: c.domain().map(Into::into),
                path: c.path().map(Into::into),
                secure: c.secure().unwrap_or(false),
                http_only: c.http_only().unwrap_or(false),
                same_site: c.same_site().map(|s| s.to_string()),
                expires: c.expires_datetime()?.unix_timestamp(),
            })
        })
        .collect()
}

/// `saved` as cookies to set again, less any that expired since.
pub fn restore(saved: &[DeviceCookie], now: i64) -> Vec<Cookie<'static>> {
    saved
        .iter()
        .filter(|c| c.expires > now)
        .filter_map(|c| {
            let expires = OffsetDateTime::from_unix_timestamp(c.expires).ok()?;
            let mut cookie = Cookie::build((c.name.clone(), c.value.clone()))
                .secure(c.secure)
                .http_only(c.http_only)
                .expires(expires);
            // The cookie crate drops one leading dot from a domain, and the
            // webview reads a domain without one as host-only. Read back from
            // accounts.google.com, any other domain (google.com) is a parent
            // the cookie was shared with, so it needs its dot back, written
            // twice to survive the first being dropped.
            cookie = match c.domain.as_deref() {
                None | Some(GOOGLE_HOST) => cookie.domain(GOOGLE_HOST),
                Some(parent) => cookie.domain(format!("..{parent}")),
            };
            if let Some(path) = &c.path {
                cookie = cookie.path(path.clone());
            }
            cookie = match c.same_site.as_deref() {
                Some("Strict") => cookie.same_site(SameSite::Strict),
                Some("Lax") => cookie.same_site(SameSite::Lax),
                Some("None") => cookie.same_site(SameSite::None),
                _ => cookie,
            };
            Some(cookie.build())
        })
        .collect()
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

    #[test]
    fn device_cookies_come_back_with_their_domain_and_without_the_expired() {
        let soon = OffsetDateTime::from_unix_timestamp(2_000).unwrap();
        let read = [
            Cookie::build(("__Host-GAPS", "g"))
                .domain(GOOGLE_HOST)
                .path("/")
                .secure(true)
                .http_only(true)
                .expires(soon)
                .build(),
            Cookie::build(("SID", "s"))
                .domain(".google.com")
                .path("/")
                .expires(OffsetDateTime::from_unix_timestamp(1_000).unwrap())
                .build(),
            Cookie::build(("LSOLH", "l")).domain(GOOGLE_HOST).build(),
        ];
        let kept = keep(&read);
        assert_eq!(
            kept.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            ["__Host-GAPS", "SID"],
            "a cookie without an expiry dies with the browser"
        );

        let set = restore(&kept, 500);
        assert_eq!(set[0].domain(), Some(GOOGLE_HOST));
        assert_eq!(set[0].secure(), Some(true));
        assert_eq!(set[0].expires_datetime(), Some(soon));
        assert_eq!(set[1].domain(), Some(".google.com"));

        let later = restore(&kept, 1_500);
        assert_eq!(later.len(), 1, "SID expired at 1000");
    }
}
