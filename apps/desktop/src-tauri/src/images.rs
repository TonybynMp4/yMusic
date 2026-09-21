//! Serves remote artwork on the `img` scheme, fetched in Rust and kept on disk.
//!
//! The webview loading Google's image CDN directly fails for a share of
//! requests (blocked or answered with an error page when a page asks for many
//! at once), and nothing it loads survives a restart. Here every image goes
//! through one pooled client, is retried with a backoff, and is cached by URL,
//! so a second visit draws from disk.
//!
//! Only Google's image hosts are fetched: the scheme is not a general proxy.

use std::path::{Path, PathBuf};
use std::time::Duration;

use sha2::{Digest, Sha256};
use tauri::http::{header, Request, Response, StatusCode};
use tauri_plugin_http::reqwest;

pub const SCHEME: &str = "img";

const ATTEMPTS: u32 = 3;
const BACKOFF: Duration = Duration::from_millis(400);
const ALLOWED_HOSTS: [&str; 3] = [".googleusercontent.com", ".ggpht.com", ".ytimg.com"];

#[derive(Clone)]
pub struct Images {
    client: reqwest::Client,
    dir: PathBuf,
}

impl Images {
    pub fn new(dir: PathBuf) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("a client with only a timeout set");
        Self { client, dir }
    }

    /// Answers `img://localhost/<encoded url>` (Linux, macOS) or
    /// `http://img.localhost/<encoded url>` (Windows), as `convertFileSrc` builds them.
    pub async fn respond(&self, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        let Some(url) = target(request) else {
            return status(StatusCode::BAD_REQUEST);
        };
        let path = self.dir.join(cache_name(&url));
        if let Ok(bytes) = tokio::fs::read(&path).await {
            return image(bytes);
        }
        match self.fetch(&url).await {
            Some(bytes) => {
                if let Err(err) = write_cache(&self.dir, &path, &bytes) {
                    log::warn!("could not cache artwork: {err}");
                }
                image(bytes)
            }
            None => status(StatusCode::BAD_GATEWAY),
        }
    }

    async fn fetch(&self, url: &str) -> Option<Vec<u8>> {
        for attempt in 0..ATTEMPTS {
            if attempt > 0 {
                tokio::time::sleep(BACKOFF * 2u32.pow(attempt - 1)).await;
            }
            match self.client.get(url).send().await {
                Ok(response) if response.status().is_success() => match response.bytes().await {
                    Ok(bytes) if content_type(&bytes).is_some() => return Some(bytes.to_vec()),
                    Ok(_) => log::debug!("artwork was not an image: {url}"),
                    Err(err) => log::debug!("artwork body failed: {err}"),
                },
                Ok(response) => log::debug!("artwork answered {}: {url}", response.status()),
                Err(err) => log::debug!("artwork request failed: {err}"),
            }
        }
        log::warn!("gave up on artwork after {ATTEMPTS} attempts: {url}");
        None
    }
}

/// The remote URL, if the request names one on an allowed host.
fn target(request: &Request<Vec<u8>>) -> Option<String> {
    let encoded = request.uri().path().trim_start_matches('/');
    let url = percent_decode(encoded)?;
    let rest = url.strip_prefix("https://")?;
    let host = rest.split(['/', '?']).next()?;
    let allowed = !host.contains(['@', '\\', ':'])
        && ALLOWED_HOSTS.iter().any(|suffix| host.ends_with(suffix));
    allowed.then_some(url)
}

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn cache_name(url: &str) -> String {
    let digest = Sha256::digest(url.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// By the bytes rather than a header, so a cached file needs nothing stored beside it.
fn content_type(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        _ => None,
    }
}

fn image(bytes: Vec<u8>) -> Response<Vec<u8>> {
    let Some(kind) = content_type(&bytes) else {
        return status(StatusCode::BAD_GATEWAY);
    };
    Response::builder()
        .header(header::CONTENT_TYPE, kind)
        .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(bytes)
        .expect("a response from valid parts")
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(code)
        .body(Vec::new())
        .expect("an empty response")
}

/// Written to a temporary name and renamed, so a crash mid-write leaves no half image.
fn write_cache(dir: &Path, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let partial = path.with_extension("part");
    std::fs::write(&partial, bytes)?;
    std::fs::rename(partial, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(uri: &str) -> Request<Vec<u8>> {
        Request::builder()
            .uri(uri)
            .body(Vec::new())
            .expect("request")
    }

    #[test]
    fn reads_the_url_from_both_platform_shapes() {
        let encoded = "https%3A%2F%2Flh3.googleusercontent.com%2Fabc%3Dw120-h120";
        for base in ["img://localhost", "http://img.localhost"] {
            assert_eq!(
                target(&request(&format!("{base}/{encoded}"))).as_deref(),
                Some("https://lh3.googleusercontent.com/abc=w120-h120"),
            );
        }
    }

    #[test]
    fn refuses_hosts_outside_the_image_cdns() {
        for url in [
            "https%3A%2F%2Fexample.com%2Fa.jpg",
            "http%3A%2F%2Flh3.googleusercontent.com%2Fa",
            "https%3A%2F%2Fgoogleusercontent.com.evil.test%2Fa",
        ] {
            assert_eq!(
                target(&request(&format!("img://localhost/{url}"))),
                None,
                "{url}"
            );
        }
    }

    #[test]
    fn knows_images_by_their_bytes() {
        assert_eq!(content_type(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(content_type(b"<!DOCTYPE html>"), None);
    }
}
