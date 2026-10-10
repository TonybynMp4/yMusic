//! The volume, kept as `volume.json` beside the settings so a launch starts
//! where the last run left off.
//!
//! Two numbers are saved: the volume, and the last one above zero, which is
//! the level Unmute goes back to. Both are slider positions in 0..=1, the unit
//! `Player::set_volume` takes. They are written once mpv's volume settles, not
//! at every step of a drag, so dragging down to zero does not save a
//! near-silent step as the level to unmute to.

use std::{
    fs,
    io::ErrorKind,
    path::PathBuf,
    sync::{
        mpsc::{Receiver, RecvTimeoutError},
        Arc, Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};

/// How long mpv's volume has to stay put before it is saved.
pub const SETTLE: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedVolume {
    pub volume: f64,
    /// The last settled volume above zero.
    pub unmuted: f64,
}

impl Default for SavedVolume {
    fn default() -> Self {
        Self {
            volume: 1.0,
            unmuted: 1.0,
        }
    }
}

impl SavedVolume {
    /// The saved pair once the volume has settled at `volume`.
    pub fn settle(self, volume: f64) -> Self {
        let volume = volume.clamp(0.0, 1.0);
        Self {
            volume,
            unmuted: if volume > 0.0 { volume } else { self.unmuted },
        }
    }

    /// Out-of-range or non-finite values from a hand-edited file are clamped,
    /// and an unmute level of zero would make Unmute do nothing.
    fn sanitize(self) -> Self {
        let fraction = |value: f64| {
            if value.is_finite() {
                value.clamp(0.0, 1.0)
            } else {
                1.0
            }
        };
        let unmuted = fraction(self.unmuted);
        Self {
            volume: fraction(self.volume),
            unmuted: if unmuted > 0.0 { unmuted } else { 1.0 },
        }
    }
}

/// The saved volume in memory and the file it persists to.
#[derive(Clone)]
pub struct VolumeStore {
    path: Option<PathBuf>,
    current: Arc<Mutex<SavedVolume>>,
}

impl VolumeStore {
    /// A file that is missing or will not parse gives full volume.
    pub fn open(path: PathBuf) -> Self {
        let saved = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<SavedVolume>(&bytes)
                .map(SavedVolume::sanitize)
                .unwrap_or_else(|error| {
                    log::error!("ignoring unreadable volume in {}: {error}", path.display());
                    SavedVolume::default()
                }),
            Err(error) if error.kind() == ErrorKind::NotFound => SavedVolume::default(),
            Err(error) => {
                log::error!("could not read {}: {error}", path.display());
                SavedVolume::default()
            }
        };
        Self {
            path: Some(path),
            current: Arc::new(Mutex::new(saved)),
        }
    }

    /// A volume that is never saved, for tests and a missing data directory.
    pub fn in_memory() -> Self {
        Self {
            path: None,
            current: Arc::new(Mutex::new(SavedVolume::default())),
        }
    }

    pub fn get(&self) -> SavedVolume {
        *self.current.lock().expect("volume mutex")
    }

    /// Records a settled volume, writing the file only when something changed.
    pub fn settle(&self, volume: f64) {
        let mut current = self.current.lock().expect("volume mutex");
        let next = current.settle(volume);
        if next == *current {
            return;
        }
        *current = next;
        if let Some(path) = &self.path {
            if let Err(error) = crate::settings::write_json(path, &next) {
                log::warn!("could not save the volume: {error}");
            }
        }
    }

    /// Saves each volume from `changes` once no other has followed it for
    /// `settle`. Returns when the sender is dropped, saving any last change:
    /// `Player::flush_volume` does that on quit.
    pub fn save_settled(&self, changes: Receiver<f64>, settle: Duration) {
        let mut pending = None;
        loop {
            let next = match pending {
                Some(_) => changes.recv_timeout(settle),
                None => changes.recv().map_err(|_| RecvTimeoutError::Disconnected),
            };
            match next {
                Ok(volume) => pending = Some(volume),
                Err(RecvTimeoutError::Timeout) => {
                    if let Some(volume) = pending.take() {
                        self.settle(volume);
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    if let Some(volume) = pending {
                        self.settle(volume);
                    }
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ymusic-volume-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("volume.json")
    }

    #[test]
    fn a_missing_file_gives_full_volume() {
        assert_eq!(
            VolumeStore::open(temp_path("missing")).get(),
            SavedVolume::default()
        );
    }

    #[test]
    fn muting_keeps_the_level_to_unmute_to() {
        let saved = SavedVolume::default().settle(0.4).settle(0.0);
        assert_eq!(
            saved,
            SavedVolume {
                volume: 0.0,
                unmuted: 0.4
            }
        );
    }

    #[test]
    fn a_settled_volume_survives_a_restart() {
        let path = temp_path("restart");
        let store = VolumeStore::open(path.clone());
        store.settle(0.6);
        store.settle(0.0);
        assert_eq!(
            VolumeStore::open(path).get(),
            SavedVolume {
                volume: 0.0,
                unmuted: 0.6
            }
        );
    }

    #[test]
    fn a_bad_file_is_clamped_or_ignored() {
        let path = temp_path("bad");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{ "volume": 3, "unmuted": 0 }"#).unwrap();
        assert_eq!(
            VolumeStore::open(path.clone()).get(),
            SavedVolume {
                volume: 1.0,
                unmuted: 1.0
            }
        );
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(VolumeStore::open(path).get(), SavedVolume::default());
    }

    #[test]
    fn only_the_settled_end_of_a_drag_is_saved() {
        let store = VolumeStore::in_memory();
        store.settle(0.5);
        let (send, changes) = mpsc::channel();
        let saver = {
            let store = store.clone();
            std::thread::spawn(move || store.save_settled(changes, Duration::from_millis(100)))
        };
        // A drag down to zero: every step arrives well inside the settle time.
        for step in [0.4, 0.3, 0.2, 0.1, 0.02, 0.0] {
            send.send(step).unwrap();
        }
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(
            store.get(),
            SavedVolume {
                volume: 0.0,
                unmuted: 0.5
            }
        );

        send.send(0.8).unwrap();
        drop(send);
        saver.join().unwrap();
        assert_eq!(
            store.get().volume,
            0.8,
            "a last change is saved on the way out"
        );
    }
}
