//! Table definitions and row mapping for the library index.

use rusqlite::{Connection, Row};

use super::{CoverArt, LocalTrack};

/// Bumped whenever the shape below changes. The library is a cache of what is
/// on disk, so an incompatible upgrade can simply drop and rescan rather than
/// carry migration code for data we can always rebuild.
const SCHEMA_VERSION: i64 = 1;

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    let found: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if found != 0 && found != SCHEMA_VERSION {
        conn.execute_batch("DROP TABLE IF EXISTS tracks; DROP TABLE IF EXISTS folders;")?;
    }

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS folders (
            path TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS tracks (
            id           TEXT PRIMARY KEY,
            folder       TEXT NOT NULL,
            path         TEXT NOT NULL UNIQUE,
            title        TEXT NOT NULL,
            artist       TEXT NOT NULL,
            album        TEXT,
            album_artist TEXT,
            track_number INTEGER,
            disc_number  INTEGER,
            year         INTEGER,
            duration_ms  INTEGER,
            codec        TEXT NOT NULL,
            bitrate      INTEGER,
            art_path     TEXT,
            art_width    INTEGER,
            art_height   INTEGER,
            mtime        INTEGER NOT NULL,
            added_at     INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS tracks_folder ON tracks (folder);
        CREATE INDEX IF NOT EXISTS tracks_sort ON tracks (artist, album, disc_number, track_number);",
    )?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

pub const SELECT_TRACK_COLUMNS_NO_ORDER: &str =
    "SELECT id, path, title, artist, album, album_artist, \
     track_number, disc_number, year, duration_ms, codec, bitrate, art_path, art_width, art_height \
     FROM tracks";

/// Album order, not filesystem order: within an album, disc then track number,
/// with untagged entries falling back to title.
pub const TRACK_ORDER: &str = "ORDER BY artist COLLATE NOCASE, IFNULL(album, '') COLLATE NOCASE, \
     IFNULL(disc_number, 0), IFNULL(track_number, 0), title COLLATE NOCASE";

pub fn select_all() -> String {
    format!("{SELECT_TRACK_COLUMNS_NO_ORDER} {TRACK_ORDER}")
}

pub fn row_to_track(row: &Row<'_>) -> rusqlite::Result<LocalTrack> {
    let art_path: Option<String> = row.get("art_path")?;
    let cover_art = match art_path {
        Some(path) => Some(CoverArt {
            path,
            width: row.get::<_, Option<u32>>("art_width")?.unwrap_or(0),
            height: row.get::<_, Option<u32>>("art_height")?.unwrap_or(0),
        }),
        None => None,
    };
    Ok(LocalTrack {
        id: row.get("id")?,
        path: row.get("path")?,
        title: row.get("title")?,
        artist: row.get("artist")?,
        album: row.get("album")?,
        album_artist: row.get("album_artist")?,
        track_number: row.get("track_number")?,
        disc_number: row.get("disc_number")?,
        year: row.get("year")?,
        duration_ms: row.get("duration_ms")?,
        codec: row.get("codec")?,
        bitrate: row.get("bitrate")?,
        cover_art,
    })
}
