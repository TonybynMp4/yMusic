//! The local music library: a filesystem scan, tag extraction, and a SQLite
//! index that the UI queries.
//!
//! This exists before any YouTube code because a file on disk is the simplest
//! possible source: `resolve` hands back the same `StreamLease` shape a
//! googlevideo URL will, minus the headers and the expiry. Playback therefore
//! never learns that two kinds of track exist.

mod scan;
mod schema;

pub use scan::{is_supported_audio, ScanReport};

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error("library database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("no track in the library with id `{0}`")]
    UnknownTrack(String),
    #[error("the file for `{0}` is no longer on disk: {1}")]
    MissingFile(String, PathBuf),
    #[error("`{0}` is not a directory")]
    NotADirectory(PathBuf),
}

pub type Result<T> = std::result::Result<T, LibraryError>;

/// Mirrors `Thumbnail` in `@ytbm/core`. Cover art is extracted to the cache
/// directory during a scan; the frontend converts `path` with Tauri's
/// `convertFileSrc` because a bare `file://` will not load in the webview.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoverArt {
    pub path: String,
    pub width: u32,
    pub height: u32,
}

/// Mirrors `Track` in `@ytbm/core`, in its local-file flavour.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalTrack {
    /// Namespaced as `local:<hash>` so it can share a queue with `yt:` ids.
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub year: Option<u32>,
    pub duration_ms: Option<i64>,
    pub codec: String,
    pub bitrate: Option<u32>,
    pub cover_art: Option<CoverArt>,
}

/// Mirrors `StreamLease` in `@ytbm/core`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalLease {
    pub track_id: String,
    pub url: String,
    pub itag: Option<i64>,
    pub codec: String,
    pub bitrate: Option<u32>,
    pub is_premium_format: bool,
    pub headers: std::collections::HashMap<String, String>,
    pub expires_at: Option<i64>,
}

pub struct Library {
    conn: Mutex<Connection>,
    /// Where extracted cover art is written. Cache, not data: deleting it only
    /// costs a rescan.
    art_dir: PathBuf,
}

impl Library {
    pub fn open(db_path: &Path, art_dir: PathBuf) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::create_dir_all(&art_dir)?;
        let conn = Connection::open(db_path)?;
        schema::migrate(&conn)?;
        Ok(Self { conn: Mutex::new(conn), art_dir })
    }

    /// For tests, and for the case where the data directory is unwritable: an
    /// in-memory library still lets the app run, it just forgets on exit.
    pub fn open_in_memory(art_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&art_dir)?;
        let conn = Connection::open_in_memory()?;
        schema::migrate(&conn)?;
        Ok(Self { conn: Mutex::new(conn), art_dir })
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let guard = self.conn.lock().expect("library mutex poisoned");
        f(&guard)
    }

    pub fn folders(&self) -> Result<Vec<String>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT path FROM folders ORDER BY path")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
        })
    }

    pub fn add_folder(&self, path: &Path) -> Result<()> {
        if !path.is_dir() {
            return Err(LibraryError::NotADirectory(path.to_path_buf()));
        }
        let canonical = path.canonicalize()?;
        self.with_conn(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO folders (path) VALUES (?1)",
                [canonical.to_string_lossy().as_ref()],
            )?;
            Ok(())
        })
    }

    /// Forgets the folder and every track under it. Files on disk are untouched.
    pub fn remove_folder(&self, path: &str) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM folders WHERE path = ?1", [path])?;
            conn.execute(
                "DELETE FROM tracks WHERE folder = ?1",
                [path],
            )?;
            Ok(())
        })
    }

    pub fn tracks(&self) -> Result<Vec<LocalTrack>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(&schema::select_all())?;
            let rows = stmt.query_map([], schema::row_to_track)?;
            Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
        })
    }

    /// Substring match across title, artist and album. Deliberately not FTS:
    /// a personal library is small enough that LIKE is instant, and FTS would
    /// need its own index to keep in sync with every scan.
    pub fn search(&self, query: &str) -> Result<Vec<LocalTrack>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return self.tracks();
        }
        let pattern = format!("%{}%", trimmed.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
        self.with_conn(|conn| {
            let sql = format!(
                "{} WHERE title LIKE ?1 ESCAPE '\\' OR artist LIKE ?1 ESCAPE '\\' \
                 OR IFNULL(album, '') LIKE ?1 ESCAPE '\\' {}",
                schema::SELECT_TRACK_COLUMNS_NO_ORDER,
                schema::TRACK_ORDER
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([&pattern], schema::row_to_track)?;
            Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
        })
    }

    pub fn track(&self, id: &str) -> Result<LocalTrack> {
        self.with_conn(|conn| {
            let sql = format!("{} WHERE id = ?1", schema::SELECT_TRACK_COLUMNS_NO_ORDER);
            let mut stmt = conn.prepare(&sql)?;
            let mut rows = stmt.query_map([id], schema::row_to_track)?;
            match rows.next() {
                Some(track) => Ok(track?),
                None => Err(LibraryError::UnknownTrack(id.to_string())),
            }
        })
    }

    /// The local analogue of resolving a stream. The file is checked here
    /// rather than at play time so a moved file surfaces as a clear error
    /// instead of an opaque mpv failure.
    pub fn resolve(&self, id: &str) -> Result<LocalLease> {
        let track = self.track(id)?;
        let path = PathBuf::from(&track.path);
        if !path.exists() {
            return Err(LibraryError::MissingFile(id.to_string(), path));
        }
        Ok(LocalLease {
            track_id: track.id,
            url: file_url(&path),
            itag: None,
            codec: track.codec,
            bitrate: track.bitrate,
            is_premium_format: false,
            headers: std::collections::HashMap::new(),
            expires_at: None,
        })
    }

    /// Rescans every registered folder. Unchanged files are skipped by mtime,
    /// so a rescan of a large library costs a stat per file rather than a full
    /// tag parse.
    pub fn scan_all(&self) -> Result<ScanReport> {
        let mut report = ScanReport::default();
        for folder in self.folders()? {
            report.merge(self.scan_folder(Path::new(&folder))?);
        }
        Ok(report)
    }

    pub fn scan_folder(&self, folder: &Path) -> Result<ScanReport> {
        scan::scan_folder(self, folder)
    }

    pub(crate) fn art_dir(&self) -> &Path {
        &self.art_dir
    }
}

/// mpv wants a URL, and a percent-encoded `file://` is the portable way to
/// hand it a path containing spaces or `#`.
pub fn file_url(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let mut encoded = String::with_capacity(raw.len() + 8);
    for byte in raw.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                encoded.push(byte as char)
            }
            // Windows drive letters and separators.
            b':' | b'\\' if cfg!(windows) => encoded.push(if byte == b'\\' { '/' } else { ':' }),
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    if cfg!(windows) {
        format!("file:///{}", encoded.trim_start_matches('/'))
    } else {
        format!("file://{encoded}")
    }
}
