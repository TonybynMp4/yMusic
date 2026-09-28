//! The engine's requests to YouTube, sent from Rust over one pooled client.
//!
//! InnerTube sends no CORS headers, so the webview's own `fetch` never sees a
//! response. `tauri-plugin-http` got around that but built a new client for
//! every request, which paid a fresh TLS handshake each time: about a second
//! per page of Liked Music. Here one client lives for the whole run, keeps its
//! connections open, and speaks HTTP/2, so a page of rows is one round trip.
//!
//! Only YouTube's hosts are reachable, redirects included: this is not a
//! general proxy for the webview.
//!
//! Requests and responses cross the IPC as raw bytes rather than JSON, because
//! bodies are binary (protobuf for BotGuard) and a JSON array of numbers would
//! be several times their size. Both are framed the same way: a little-endian
//! `u32` length, that many bytes of JSON metadata, then the body.

use std::sync::Arc;
use std::time::Duration;

use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, CONTENT_LENGTH, ORIGIN},
    redirect, Method, Url,
};
use serde::{Deserialize, Serialize};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REDIRECTS: usize = 10;

#[derive(Debug, Deserialize)]
pub struct RequestHead {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseHead {
    pub status: u16,
    pub status_text: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
}

#[derive(Clone)]
pub struct Http {
    client: reqwest::Client,
}

impl Default for Http {
    fn default() -> Self {
        Self::new()
    }
}

impl Http {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TIMEOUT)
            // Signed out, YouTube hands out visitor cookies and expects them
            // back, as the HTTP plugin's jar did. Signed in, the engine sends
            // its own Cookie header and the jar stays out of the way.
            .cookie_provider(Arc::new(reqwest::cookie::Jar::default()))
            .redirect(redirect::Policy::custom(|attempt| {
                if attempt.previous().len() > MAX_REDIRECTS {
                    attempt.error("too many redirects")
                } else if allowed(attempt.url()) {
                    attempt.follow()
                } else {
                    let url = attempt.url().to_string();
                    attempt.error(format!("redirected off YouTube to {url}"))
                }
            }))
            .user_agent(concat!("ymusic/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("a client with a timeout, a jar and a redirect policy");
        Self { client }
    }

    /// Takes a framed request and returns a framed response.
    pub async fn fetch(&self, frame: &[u8]) -> Result<Vec<u8>, String> {
        let (head, body) = split::<RequestHead>(frame)?;
        let (head, body) = self.send(head, body.to_vec()).await?;
        Ok(join(&head, &body))
    }

    pub async fn send(
        &self,
        head: RequestHead,
        body: Vec<u8>,
    ) -> Result<(ResponseHead, Vec<u8>), String> {
        let url = Url::parse(&head.url).map_err(|err| format!("bad url {}: {err}", head.url))?;
        if !allowed(&url) {
            return Err(format!("not a YouTube url: {url}"));
        }
        let method = Method::from_bytes(head.method.as_bytes())
            .map_err(|_| format!("bad method {}", head.method))?;

        let mut headers = HeaderMap::new();
        for (name, value) in &head.headers {
            let name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| format!("bad header name {name}"))?;
            // An empty Origin means "send none". BotGuard's challenge is bound
            // to the requesting origin and refused later if that was YouTube's.
            if name == ORIGIN && value.is_empty() {
                continue;
            }
            let value =
                HeaderValue::from_str(value).map_err(|_| format!("bad value for header {name}"))?;
            headers.append(name, value);
        }
        // Fetch sends a zero length for a bodiless POST, and Google's servers
        // answer 411 without one.
        if body.is_empty() && matches!(method, Method::POST | Method::PUT) {
            headers.insert(CONTENT_LENGTH, HeaderValue::from_static("0"));
        }

        let mut request = self.client.request(method, url).headers(headers);
        if !body.is_empty() {
            request = request.body(body);
        }
        let response = request.send().await.map_err(describe)?;

        let status = response.status();
        let head = ResponseHead {
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or_default().to_string(),
            url: response.url().to_string(),
            headers: response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    Some((name.to_string(), value.to_str().ok()?.to_string()))
                })
                .collect(),
        };
        let body = response.bytes().await.map_err(describe)?;
        Ok((head, body.to_vec()))
    }
}

/// The hosts `capabilities/default.json` allowed the HTTP plugin, kept as they were.
fn allowed(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    match host {
        "music.youtube.com"
        | "www.youtube.com"
        | "youtubei.googleapis.com"
        | "jnn-pa.googleapis.com" => true,
        "www.google.com" => url.path().starts_with("/js/"),
        _ => host.ends_with(".googlevideo.com"),
    }
}

/// reqwest's `Display` leaves out the cause, which is the part worth reading.
fn describe(err: reqwest::Error) -> String {
    let mut message = err.to_string();
    let mut source = std::error::Error::source(&err);
    while let Some(cause) = source {
        message.push_str(&format!(": {cause}"));
        source = cause.source();
    }
    message
}

fn split<T: for<'de> Deserialize<'de>>(frame: &[u8]) -> Result<(T, &[u8]), String> {
    let (length, rest) = frame
        .split_first_chunk::<4>()
        .ok_or("frame too short for its length")?;
    let length = u32::from_le_bytes(*length) as usize;
    if rest.len() < length {
        return Err("frame shorter than its header".into());
    }
    let (head, body) = rest.split_at(length);
    let head = serde_json::from_slice(head).map_err(|err| format!("bad frame header: {err}"))?;
    Ok((head, body))
}

fn join<T: Serialize>(head: &T, body: &[u8]) -> Vec<u8> {
    let head = serde_json::to_vec(head).expect("a head of strings and numbers");
    let mut frame = Vec::with_capacity(4 + head.len() + body.len());
    frame.extend_from_slice(&(head.len() as u32).to_le_bytes());
    frame.extend_from_slice(&head);
    frame.extend_from_slice(body);
    frame
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn allows_only_youtube_hosts() {
        assert!(allowed(&url(
            "https://music.youtube.com/youtubei/v1/browse"
        )));
        assert!(allowed(&url(
            "https://rr1---sn-abc.googlevideo.com/videoplayback"
        )));
        assert!(allowed(&url("https://www.google.com/js/th/abc.js")));
        assert!(!allowed(&url("https://www.google.com/search?q=x")));
        assert!(!allowed(&url("http://www.youtube.com/")));
        assert!(!allowed(&url("https://evilgooglevideo.com/")));
        assert!(!allowed(&url("https://example.com/")));
    }

    #[test]
    fn a_frame_splits_back_into_its_parts() {
        let head = RequestHead {
            method: "POST".into(),
            url: "https://www.youtube.com/".into(),
            headers: vec![("A".into(), "b".into())],
        };
        let frame = join(
            &serde_json::json!({ "method": head.method, "url": head.url, "headers": head.headers }),
            b"\x00body",
        );
        let (parsed, body) = split::<RequestHead>(&frame).unwrap();
        assert_eq!(parsed.url, head.url);
        assert_eq!(parsed.headers, head.headers);
        assert_eq!(body, b"\x00body");
    }

    #[test]
    fn a_truncated_frame_is_an_error() {
        assert!(split::<RequestHead>(&[1, 0]).is_err());
        assert!(split::<RequestHead>(&[9, 0, 0, 0, b'{']).is_err());
    }
}
