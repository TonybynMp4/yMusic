//! Filesystem walk and tag extraction.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};


use lofty::file::{AudioFile, FileType, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use super::{Library, Result};

/// Extensions mpv can decode and lofty can read tags from. Checked before
/// opening anything, so a folder of JPEGs costs one string compare each.
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "m4a", "m4b", "aac", "ogg", "oga", "opus", "wav", "wv", "aiff", "aif", "ape",
    "mpc", "alac",
];

pub fn is_supported_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| AUDIO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub added: usize,
    pub updated: usize,
    /// Skipped because the file has not changed since the last scan.
    pub unchanged: usize,
    /// Files that looked like audio but could not be read. Reported rather
    /// than thrown away so a corrupt file is visible instead of silently
    /// missing from the library.
    pub failed: Vec<ScanFailure>,
    pub removed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanFailure {
    pub path: String,
    pub reason: String,
}

impl ScanReport {
    pub fn merge(&mut self, other: ScanReport) {
        self.added += other.added;
        self.updated += other.updated;
        self.unchanged += other.unchanged;
        self.removed += other.removed;
        self.failed.extend(other.failed);
    }
}

/// Stable across runs and independent of tags, so re-tagging a file updates the
/// existing row instead of orphaning it and creating a duplicate. Moving the
/// file does create a new id -- that is the tradeoff for not having to
/// content-hash every file on every scan.
fn track_id_for(path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    format!("local:{:x}", hasher.finalize())[..22].to_string()
}

/// SQLite has no unsigned integer type, so times are carried as i64.
fn mtime_of(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub(super) fn scan_folder(library: &Library, folder: &Path) -> Result<ScanReport> {
    let folder_key = folder.to_string_lossy().to_string();
    let mut report = ScanReport::default();
    let mut seen: Vec<String> = Vec::new();

    for entry in WalkDir::new(folder).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() || !is_supported_audio(entry.path()) {
            continue;
        }
        let path = entry.path();
        let id = track_id_for(path);
        seen.push(id.clone());

        let mtime = mtime_of(path);
        let known_mtime: Option<i64> = library.with_conn(|conn| {
            Ok(conn
                .query_row("SELECT mtime FROM tracks WHERE id = ?1", [&id], |row| row.get(0))
                .ok())
        })?;

        if known_mtime == Some(mtime) {
            report.unchanged += 1;
            continue;
        }
        let is_update = known_mtime.is_some();

        match index_file(library, &folder_key, &id, path, mtime) {
            Ok(()) if is_update => report.updated += 1,
            Ok(()) => report.added += 1,
            Err(err) => report.failed.push(ScanFailure {
                path: path.to_string_lossy().to_string(),
                reason: err.to_string(),
            }),
        }
    }

    report.removed = prune_missing(library, &folder_key, &seen)?;
    Ok(report)
}

/// Drops rows for files that vanished from the folder since the last scan.
fn prune_missing(library: &Library, folder_key: &str, seen: &[String]) -> Result<usize> {
    library.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT id FROM tracks WHERE folder = ?1")?;
        let existing: Vec<String> = stmt
            .query_map([folder_key], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut removed = 0;
        for id in existing {
            if !seen.contains(&id) {
                conn.execute("DELETE FROM tracks WHERE id = ?1", [&id])?;
                removed += 1;
            }
        }
        Ok(removed)
    })
}

fn index_file(
    library: &Library,
    folder_key: &str,
    id: &str,
    path: &Path,
    mtime: i64,
) -> Result<()> {
    let tagged = Probe::open(path)
        .map_err(to_io)?
        
        .read()
        .map_err(to_io)?;

    let properties = tagged.properties();
    let duration_ms = {
        let ms = properties.duration().as_millis();
        if ms == 0 {
            None
        } else {
            Some(ms as i64)
        }
    };
    let codec = codec_name(tagged.file_type());
    let bitrate = properties.audio_bitrate().filter(|b| *b > 0);

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());

    // An untitled file is still playable, so fall back to the filename rather
    // than refusing to index it.
    let title = tag
        .and_then(|t| t.title().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
        });
    let artist = tag
        .and_then(|t| t.artist().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Unknown Artist".to_string());
    let album = tag.and_then(|t| t.album().map(|s| s.to_string())).filter(|s| !s.trim().is_empty());
    let album_artist = tag
        .and_then(|t| t.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty());
    let track_number = tag.and_then(|t| t.track());
    let disc_number = tag.and_then(|t| t.disk());
    let year = tag.and_then(|t| t.year());

    let art = tag.and_then(|t| extract_cover_art(library, id, t).ok().flatten());

    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);

    library.with_conn(|conn| {
        conn.execute(
            "INSERT INTO tracks (id, folder, path, title, artist, album, album_artist,
                track_number, disc_number, year, duration_ms, codec, bitrate,
                art_path, art_width, art_height, mtime, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(id) DO UPDATE SET
                folder = excluded.folder, path = excluded.path, title = excluded.title,
                artist = excluded.artist, album = excluded.album,
                album_artist = excluded.album_artist, track_number = excluded.track_number,
                disc_number = excluded.disc_number, year = excluded.year,
                duration_ms = excluded.duration_ms, codec = excluded.codec,
                bitrate = excluded.bitrate, art_path = excluded.art_path,
                art_width = excluded.art_width, art_height = excluded.art_height,
                mtime = excluded.mtime",
            params![
                id,
                folder_key,
                path.to_string_lossy(),
                title,
                artist,
                album,
                album_artist,
                track_number,
                disc_number,
                year,
                duration_ms,
                codec,
                bitrate,
                art.as_ref().map(|a| a.0.clone()),
                art.as_ref().map(|a| a.1),
                art.as_ref().map(|a| a.2),
                mtime,
                now,
            ],
        )?;
        Ok(())
    })
}

/// Writes the first embedded picture to the art cache and returns
/// (path, width, height). Art is written once per track id and overwritten on
/// rescan, so the cache cannot grow without bound.
fn extract_cover_art(
    library: &Library,
    id: &str,
    tag: &Tag,
) -> Result<Option<(String, u32, u32)>> {
    let Some(picture) = tag.pictures().first() else {
        return Ok(None);
    };
    let extension = picture
        .mime_type()
        .and_then(|mime| match mime.as_str() {
            "image/png" => Some("png"),
            "image/jpeg" => Some("jpg"),
            "image/webp" => Some("webp"),
            _ => None,
        })
        .unwrap_or("bin");

    // `local:` is in the id and is not legal in a Windows filename.
    let file_name = format!("{}.{extension}", id.replace(':', "_"));
    let out = library.art_dir().join(file_name);
    std::fs::write(&out, picture.data())?;

    // Dimensions are only a hint for layout; the webview scales the real image
    // anyway, so an unparsed header is not worth failing a scan over.
    let (width, height) = image_dimensions(picture.data()).unwrap_or((0, 0));
    Ok(Some((out.to_string_lossy().to_string(), width, height)))
}

/// Minimal PNG/JPEG header reads. Avoids pulling in a full image crate for two
/// numbers that only affect layout.
fn image_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.starts_with(&[0x89, b'P', b'N', b'G']) && data.len() >= 24 {
        let width = u32::from_be_bytes(data[16..20].try_into().ok()?);
        let height = u32::from_be_bytes(data[20..24].try_into().ok()?);
        return Some((width, height));
    }
    if data.starts_with(&[0xFF, 0xD8]) {
        let mut i = 2;
        while i + 9 < data.len() {
            if data[i] != 0xFF {
                i += 1;
                continue;
            }
            let marker = data[i + 1];
            // SOF0..SOF15, excluding the non-frame markers DHT/JPG/DAC.
            if (0xC0..=0xCF).contains(&marker) && ![0xC4, 0xC8, 0xCC].contains(&marker) {
                let height = u16::from_be_bytes([data[i + 5], data[i + 6]]) as u32;
                let width = u16::from_be_bytes([data[i + 7], data[i + 8]]) as u32;
                return Some((width, height));
            }
            let length = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
            i += 2 + length;
        }
    }
    None
}

/// Matches the `AudioCodec` enum in `@ytbm/core`.
fn codec_name(file_type: FileType) -> String {
    match file_type {
        FileType::Mpeg => "mp3",
        FileType::Flac => "flac",
        // Could also be ALAC; lofty does not expose the codec through the
        // generic handle, and the distinction does not change playback.
        FileType::Mp4 => "aac",
        FileType::Opus => "opus",
        FileType::Vorbis => "vorbis",
        FileType::Wav | FileType::Aiff => "pcm",
        _ => "unknown",
    }
    .to_string()
}

fn to_io(err: lofty::error::LoftyError) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, err.to_string())
}
