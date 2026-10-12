//! Serves remote artwork on the `img` scheme, fetched in Rust and kept on disk.
//!
//! The webview loading Google's image CDN directly fails for a share of
//! requests (blocked or answered with an error page when a page asks for many
//! at once), and nothing it loads survives a restart. Here every image goes
//! through one pooled client, is retried with a backoff, and is cached by URL,
//! so a second visit draws from disk.
//!
//! Images are asked for as WebP where Google's hosts can send it at a smaller
//! size than the JPEG, and the cache is capped at `CAP_BYTES`, least recently
//! drawn first. Files are named after the URL the page asked for, so a JPEG
//! cached before still answers it.
//!
//! Only Google's image hosts are fetched: the scheme is not a general proxy.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use sha2::{Digest, Sha256};
use tauri::http::{header, Request, Response, StatusCode};

pub const SCHEME: &str = "img";

const ATTEMPTS: u32 = 3;
const BACKOFF: Duration = Duration::from_millis(400);
const ALLOWED_HOSTS: [&str; 3] = [".googleusercontent.com", ".ggpht.com", ".ytimg.com"];
/// The cache trims itself back to `TRIM_TO_BYTES` once it passes this.
const CAP_BYTES: u64 = 100 * 1024 * 1024;
const TRIM_TO_BYTES: u64 = 90 * 1024 * 1024;
/// How much is written between two checks of the cache's size.
const CHECK_EVERY_BYTES: u64 = 4 * 1024 * 1024;
/// Above this width Google's WebP is larger than its JPEG at the same quality.
const WEBP_MAX_WIDTH: u32 = 800;

#[derive(Clone)]
pub struct Images {
    client: reqwest::Client,
    dir: PathBuf,
    written: Arc<AtomicU64>,
    trimming: Arc<AtomicBool>,
}

impl Images {
    pub fn new(dir: PathBuf) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("a client with only a timeout set");
        let images = Self {
            client,
            dir,
            written: Arc::new(AtomicU64::new(0)),
            trimming: Arc::new(AtomicBool::new(false)),
        };
        // A cache left over the cap by an older version, or a crash mid-trim.
        images.trim_in_background();
        images
    }

    /// Answers `img://localhost/<encoded url>` (Linux, macOS) or
    /// `http://img.localhost/<encoded url>` (Windows), as `convertFileSrc` builds them.
    pub async fn respond(&self, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        let Some(url) = target(request) else {
            return status(StatusCode::BAD_REQUEST);
        };
        let path = self.dir.join(cache_name(&url));
        if let Ok(bytes) = tokio::fs::read(&path).await {
            // The trim goes by modification time, so a drawn image counts as recent.
            // Blocking file calls, kept off the runtime and out of the response's way.
            tauri::async_runtime::spawn_blocking(move || touch(&path));
            return image(bytes);
        }
        let webp = match as_webp(&url) {
            Some(webp) => self.fetch(&webp).await,
            None => None,
        };
        let fetched = match webp {
            Some(bytes) => Some(bytes),
            None => self.fetch(&url).await,
        };
        match fetched {
            Some(bytes) => {
                match write_cache(&self.dir, &path, &bytes) {
                    Ok(()) => self.wrote(bytes.len() as u64),
                    Err(err) => log::warn!("could not cache artwork: {err}"),
                }
                image(bytes)
            }
            None => {
                log::warn!("could not fetch artwork: {url}");
                status(StatusCode::BAD_GATEWAY)
            }
        }
    }

    fn wrote(&self, bytes: u64) {
        let since = self.written.fetch_add(bytes, Ordering::Relaxed) + bytes;
        if since >= CHECK_EVERY_BYTES {
            self.written.store(0, Ordering::Relaxed);
            self.trim_in_background();
        }
    }

    fn trim_in_background(&self) {
        if self.trimming.swap(true, Ordering::AcqRel) {
            return;
        }
        let (dir, trimming) = (self.dir.clone(), self.trimming.clone());
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(err) = trim(&dir, CAP_BYTES, TRIM_TO_BYTES) {
                log::warn!("could not trim the artwork cache: {err}");
            }
            trimming.store(false, Ordering::Release);
        });
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
                Ok(response) => {
                    log::debug!("artwork answered {}: {url}", response.status());
                    if !retryable(response.status()) {
                        return None;
                    }
                }
                Err(err) => log::debug!("artwork request failed: {err}"),
            }
        }
        log::debug!("gave up on artwork after {ATTEMPTS} attempts: {url}");
        None
    }
}

/// Whether an error answer may go away if asked again. Only "not there" is
/// final (a missing WebP copy answers 404): the CDN may block a burst with
/// other client errors, such as a 403, that clear on a later try.
fn retryable(status: StatusCode) -> bool {
    status != StatusCode::NOT_FOUND && status != StatusCode::GONE
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

/// The same image as WebP, when the host can send it smaller than the URL asked for.
///
/// Google's image hosts take their options after the last `=`, separated by
/// `-`: `rj` asks for JPEG and `rw` for WebP. YouTube's video thumbnails have
/// a WebP copy under `vi_webp`, unless the URL is signed with a query.
fn as_webp(url: &str) -> Option<String> {
    if let Some(rest) = url.strip_prefix("https://i.ytimg.com/vi/") {
        let (id, name) = rest.split_once('/')?;
        let name = name.strip_suffix(".jpg")?;
        if name.contains(['/', '?']) || id.contains('?') {
            return None;
        }
        return Some(format!("https://i.ytimg.com/vi_webp/{id}/{name}.webp"));
    }
    let (base, options) = url.rsplit_once('=')?;
    if base.contains('?') || options.contains(['/', '?']) {
        return None;
    }
    let options: Vec<&str> = options.split('-').collect();
    let width = options.iter().find_map(|option| {
        let number = option
            .strip_prefix('w')
            .or_else(|| option.strip_prefix('s'))?;
        number.parse::<u32>().ok()
    })?;
    if width > WEBP_MAX_WIDTH || !options.contains(&"rj") {
        return None;
    }
    let options: Vec<&str> = options
        .into_iter()
        .map(|option| if option == "rj" { "rw" } else { option })
        .collect();
    Some(format!("{base}={}", options.join("-")))
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
/// Each write gets its own temporary name: the webview can ask for the same image
/// again while the first download is still being written, and two writers
/// sharing one name would see the second rename fail.
fn write_cache(dir: &Path, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    static WRITES: AtomicU64 = AtomicU64::new(0);
    std::fs::create_dir_all(dir)?;
    let partial = path.with_extension(format!("{}.part", WRITES.fetch_add(1, Ordering::Relaxed)));
    let written = std::fs::write(&partial, bytes).and_then(|()| std::fs::rename(&partial, path));
    if written.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    written
}

fn touch(path: &Path) {
    if let Ok(file) = std::fs::File::options().append(true).open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

/// Deletes the least recently drawn images until the folder holds `to` bytes,
/// if it holds more than `cap`. Temporary files a crash left behind go too.
/// A folder not created yet counts as empty, and an entry that cannot be read
/// (a write renaming it away, say) is skipped.
fn trim(dir: &Path, cap: u64, to: u64) -> std::io::Result<()> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err),
    };
    let mut files = Vec::new();
    let mut total = 0;
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let path = entry.path();
        let stale_partial = path.extension().is_some_and(|ext| ext == "part")
            && modified
                .elapsed()
                .is_ok_and(|age| age > Duration::from_secs(3600));
        if stale_partial {
            let _ = std::fs::remove_file(&path);
            continue;
        }
        total += meta.len();
        files.push((modified, meta.len(), path));
    }
    if total <= cap {
        return Ok(());
    }
    files.sort_by_key(|(modified, ..)| *modified);
    for (_, len, path) in files {
        if total <= to {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total -= len;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_google_for_webp_up_to_the_width_where_it_is_smaller() {
        assert_eq!(
            as_webp("https://lh3.googleusercontent.com/abc=w120-h120-l90-rj").as_deref(),
            Some("https://lh3.googleusercontent.com/abc=w120-h120-l90-rw")
        );
        assert_eq!(
            as_webp("https://yt3.ggpht.com/abc=s800-c-k-rj").as_deref(),
            Some("https://yt3.ggpht.com/abc=s800-c-k-rw")
        );
        assert_eq!(
            as_webp("https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj"),
            None
        );
        assert_eq!(
            as_webp("https://lh3.googleusercontent.com/abc=w120-h120"),
            None
        );
        assert_eq!(as_webp("https://lh3.googleusercontent.com/abc"), None);
    }

    #[test]
    fn asks_for_the_webp_copy_of_unsigned_video_thumbnails() {
        assert_eq!(
            as_webp("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg").as_deref(),
            Some("https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/hqdefault.webp")
        );
        assert_eq!(
            as_webp("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?sqp=abc&rs=def"),
            None
        );
    }

    #[test]
    fn trims_the_least_recently_drawn_images_first() {
        let dir = scratch("trim");
        let old = SystemTime::now() - Duration::from_secs(600);
        for (index, name) in ["a", "b", "c", "d"].iter().enumerate() {
            let path = dir.join(name);
            std::fs::write(&path, [0u8; 100]).unwrap();
            let file = std::fs::File::options().append(true).open(&path).unwrap();
            file.set_modified(old + Duration::from_secs(index as u64))
                .unwrap();
        }
        // Drawn again just now, so the oldest by write time but the newest by use.
        touch(&dir.join("a"));

        trim(&dir, 300, 200).unwrap();
        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(left, ["a", "d"]);
    }

    #[test]
    fn concurrent_writes_of_one_image_all_succeed() {
        let dir = std::env::temp_dir().join(format!("ymusic-images-race-{}", std::process::id()));
        let path = dir.join(cache_name("https://lh3.googleusercontent.com/abc"));
        let writers: Vec<_> = (0..8)
            .map(|_| {
                let (dir, path) = (dir.clone(), path.clone());
                std::thread::spawn(move || {
                    (0..50).all(|_| write_cache(&dir, &path, &[0xFF, 0xD8, 0xFF, 0xE0]).is_ok())
                })
            })
            .collect();
        let all_ok = writers.into_iter().all(|writer| writer.join().unwrap());
        let leftovers = std::fs::read_dir(&dir).unwrap().count();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(all_ok);
        assert_eq!(leftovers, 1, "only the image itself, no temporary files");
    }

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

    /// An empty folder of its own under the system's temporary one.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ymusic-images-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        names
    }

    fn age(path: &Path, by: Duration) {
        let file = std::fs::File::options().append(true).open(path).unwrap();
        file.set_modified(SystemTime::now() - by).unwrap();
    }

    #[test]
    fn trims_a_folder_not_created_yet_as_empty() {
        let dir = scratch("trim-missing");
        let trimmed = trim(&dir.join("images"), 0, 0);
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(trimmed.is_ok());
    }

    #[test]
    fn keeps_everything_under_the_cap_and_leaves_subfolders_alone() {
        let dir = scratch("trim-under");
        std::fs::write(dir.join("a"), [0u8; 100]).unwrap();
        std::fs::write(dir.join("b"), [0u8; 100]).unwrap();
        // Bigger than the cap on its own, so counting it would trigger a trim.
        std::fs::create_dir(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub").join("c"), [0u8; 1000]).unwrap();

        trim(&dir, 250, 100).unwrap();
        let left = names(&dir);
        let nested = names(&dir.join("sub"));
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(left, ["a", "b", "sub"]);
        assert_eq!(nested, ["c"]);
    }

    #[test]
    fn sweeps_temporary_files_a_crash_left_but_not_ones_being_written() {
        let dir = scratch("trim-part");
        let image = dir.join("abc");
        std::fs::write(&image, [0u8; 10]).unwrap();
        age(&image, Duration::from_secs(7200));
        let stale = dir.join("abc.0.part");
        std::fs::write(&stale, [0u8; 10]).unwrap();
        age(&stale, Duration::from_secs(7200));
        std::fs::write(dir.join("abc.1.part"), [0u8; 10]).unwrap();

        trim(&dir, u64::MAX, u64::MAX).unwrap();
        let left = names(&dir);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(left, ["abc", "abc.1.part"]);
    }

    #[test]
    fn retries_only_answers_that_may_change() {
        for code in [404, 410] {
            assert!(!retryable(StatusCode::from_u16(code).unwrap()), "{code}");
        }
        for code in [400, 403, 408, 429, 500, 502, 503] {
            assert!(retryable(StatusCode::from_u16(code).unwrap()), "{code}");
        }
    }

    /// A local HTTP server giving `answers` in turn, the last one from then on.
    /// Returns its address and how many requests it has served.
    fn serve(answers: Vec<(&'static str, &'static [u8])>) -> (String, Arc<AtomicU64>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}/image", listener.local_addr().unwrap());
        let served = Arc::new(AtomicU64::new(0));
        let count = served.clone();
        std::thread::spawn(move || {
            for (index, stream) in listener.incoming().enumerate() {
                let mut stream = stream.unwrap();
                let mut request = Vec::new();
                let mut buf = [0u8; 1024];
                while !request.ends_with(b"\r\n\r\n") {
                    let read = stream.read(&mut buf).unwrap();
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buf[..read]);
                }
                let (status, body) = answers[index.min(answers.len() - 1)];
                let head = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                count.fetch_add(1, Ordering::SeqCst);
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body);
            }
        });
        (address, served)
    }

    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0];

    #[test]
    fn gives_up_on_a_client_error_after_one_request() {
        let (url, served) = serve(vec![("404 Not Found", b"")]);
        let dir = scratch("fetch-404");
        let images = Images::new(dir.join("images"));
        let started = std::time::Instant::now();
        let fetched = tauri::async_runtime::block_on(images.fetch(&url));
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(fetched, None);
        assert_eq!(served.load(Ordering::SeqCst), 1);
        assert!(
            started.elapsed() < BACKOFF,
            "no backoff before falling back"
        );
    }

    #[test]
    fn retries_server_errors_and_html_until_an_image_comes() {
        let (url, served) = serve(vec![
            ("503 Service Unavailable", b""),
            ("200 OK", b"<!DOCTYPE html>"),
            ("200 OK", JPEG),
        ]);
        let dir = scratch("fetch-retry");
        let images = Images::new(dir.join("images"));
        let fetched = tauri::async_runtime::block_on(images.fetch(&url));
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(fetched.as_deref(), Some(JPEG));
        assert_eq!(served.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn knows_images_by_their_bytes() {
        assert_eq!(content_type(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(content_type(b"<!DOCTYPE html>"), None);
    }
}
