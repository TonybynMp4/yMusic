//! The queue saved across restarts, as two files beside the settings.
//!
//! `queue.json` holds the queue itself, and what this device last wrote to
//! the account's server queue. Its shape belongs to the frontend, which
//! validates it on the way back in, so Rust stores it as it comes.
//! `queue-position.json` holds the playing song's id and how far into it
//! playback was. It is apart because it changes far more often than the
//! queue, which can be a whole playlist, and it is written on exit too, from
//! mpv's own position, after the frontend can no longer say.

use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuePosition {
    pub track_id: String,
    pub position_ms: u64,
}

/// Both files, as read at launch.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQueue {
    pub queue: Option<serde_json::Value>,
    pub position: Option<QueuePosition>,
}

pub struct QueueStore {
    dir: Option<PathBuf>,
    /// Held across a write, so two never share the `.partial` file.
    writing: Mutex<()>,
}

const QUEUE_FILE: &str = "queue.json";
const POSITION_FILE: &str = "queue-position.json";

impl QueueStore {
    pub fn open(dir: PathBuf) -> Self {
        Self {
            dir: Some(dir),
            writing: Mutex::new(()),
        }
    }

    /// A store that keeps nothing, for tests and a missing data directory.
    pub fn in_memory() -> Self {
        Self {
            dir: None,
            writing: Mutex::new(()),
        }
    }

    /// What was saved. A file that is missing or will not parse reads as
    /// nothing saved: an empty queue at launch beats a player that won't start.
    pub fn load(&self) -> SavedQueue {
        let Some(dir) = &self.dir else {
            return SavedQueue::default();
        };
        let queue = read::<serde_json::Value>(&dir.join(QUEUE_FILE)).filter(|q| !q.is_null());
        SavedQueue {
            queue,
            position: read(&dir.join(POSITION_FILE)),
        }
    }

    /// Replaces the saved queue. Null clears it.
    pub fn save_queue(&self, queue: &serde_json::Value) -> Result<(), String> {
        self.write(QUEUE_FILE, queue)
    }

    pub fn save_position(&self, position: &QueuePosition) -> Result<(), String> {
        self.write(POSITION_FILE, position)
    }

    fn write(&self, name: &str, value: &impl Serialize) -> Result<(), String> {
        let Some(dir) = &self.dir else {
            return Ok(());
        };
        let _writing = self.writing.lock().expect("queue store mutex");
        let json = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        crate::files::write_atomically(&dir.join(name), &json)
            .map_err(|error| format!("could not save the queue: {error}"))
    }
}

fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .inspect_err(|error| {
                log::error!("ignoring unreadable {}: {error}", path.display());
            })
            .ok(),
        Err(error) if error.kind() == ErrorKind::NotFound => None,
        Err(error) => {
            log::error!("could not read {}: {error}", path.display());
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ymusic-queue-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn nothing_saved_reads_as_nothing() {
        assert_eq!(
            QueueStore::open(temp_dir("empty")).load(),
            SavedQueue::default()
        );
    }

    #[test]
    fn the_queue_and_position_survive_a_restart() {
        let dir = temp_dir("restart");
        let store = QueueStore::open(dir.clone());
        let queue = json!({ "items": [{ "id": "yt:one" }], "cursor": 0 });
        store.save_queue(&queue).unwrap();
        let position = QueuePosition {
            track_id: "yt:one".into(),
            position_ms: 61_500,
        };
        store.save_position(&position).unwrap();

        let saved = QueueStore::open(dir).load();
        assert_eq!(saved.queue, Some(queue));
        assert_eq!(saved.position, Some(position));
    }

    #[test]
    fn a_cleared_queue_reads_as_nothing() {
        let dir = temp_dir("cleared");
        let store = QueueStore::open(dir.clone());
        store.save_queue(&json!({ "cursor": 0 })).unwrap();
        store.save_queue(&serde_json::Value::Null).unwrap();
        assert_eq!(QueueStore::open(dir).load().queue, None);
    }

    #[test]
    fn a_corrupt_file_reads_as_nothing() {
        let dir = temp_dir("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(QUEUE_FILE), "{ not json").unwrap();
        fs::write(dir.join(POSITION_FILE), r#"{ "trackId": 3 }"#).unwrap();
        assert_eq!(QueueStore::open(dir).load(), SavedQueue::default());
    }
}
