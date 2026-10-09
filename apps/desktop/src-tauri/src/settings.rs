//! The user's settings, kept as `settings.json` beside the app's other data.
//!
//! Every field has a default and the file is read with `#[serde(default)]`, so
//! a file written by an older build (missing a field) or a newer one (with a
//! field this build does not know) still loads. A file that will not parse at
//! all is logged and replaced by the defaults: losing a preference is a much
//! better outcome than a player that refuses to start.

use std::{fs, io::ErrorKind, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioQuality {
    #[default]
    High,
    Normal,
    Low,
}

/// How stable volume evens songs out.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StableVolume {
    #[default]
    Off,
    /// Loud songs turned down and quiet ones turned up.
    On,
    /// Loud songs turned down, quiet ones left alone.
    LoudOnly,
}

/// Where searches are remembered.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchHistory {
    /// On the account, as YouTube Music records them.
    #[default]
    Youtube,
    /// In a list on this device, with searches kept off the account.
    Device,
    /// Nowhere.
    Off,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// When the queue runs out, its suggestions play on.
    pub autoplay: bool,
    pub audio_quality: AudioQuality,
    pub stable_volume: StableVolume,
    /// An mpv `audio-device` name. `auto` follows the system's default output.
    pub audio_device: String,
    pub skip_disliked: bool,
    pub pause_watch_history: bool,
    pub search_history: SearchHistory,
    /// Closing the window hides it to the tray and playback carries on.
    pub close_to_tray: bool,
    pub check_for_updates: bool,
    pub include_prereleases: bool,
    /// Loudness, peaks and the stable volume gain, measured as a song plays.
    pub stats_for_nerds: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            autoplay: true,
            audio_quality: AudioQuality::High,
            stable_volume: StableVolume::Off,
            audio_device: "auto".into(),
            skip_disliked: false,
            pause_watch_history: false,
            search_history: SearchHistory::Youtube,
            close_to_tray: false,
            check_for_updates: true,
            include_prereleases: false,
            stats_for_nerds: false,
        }
    }
}

impl Settings {
    /// Applies the fields present in `patch` and leaves the rest alone.
    pub fn merge(&self, patch: serde_json::Value) -> Result<Self, String> {
        let serde_json::Value::Object(patch) = patch else {
            return Err("a settings patch is an object".into());
        };
        let mut current = serde_json::to_value(self).expect("settings serialize");
        let fields = current.as_object_mut().expect("settings are an object");
        for (key, value) in patch {
            if !fields.contains_key(&key) {
                return Err(format!("no setting called `{key}`"));
            }
            fields.insert(key, value);
        }
        serde_json::from_value(current).map_err(|error| format!("bad settings patch: {error}"))
    }
}

/// The settings in memory and the file they persist to.
pub struct SettingsStore {
    path: Option<PathBuf>,
    current: Mutex<Settings>,
}

impl SettingsStore {
    pub fn open(path: PathBuf) -> Self {
        let current = match fs::read(&path) {
            Ok(bytes) => read(&bytes).unwrap_or_else(|error| {
                log::error!(
                    "ignoring unreadable settings in {}: {error}",
                    path.display()
                );
                Settings::default()
            }),
            Err(error) if error.kind() == ErrorKind::NotFound => Settings::default(),
            Err(error) => {
                log::error!("could not read {}: {error}", path.display());
                Settings::default()
            }
        };
        Self {
            path: Some(path),
            current: Mutex::new(current),
        }
    }

    /// Settings that are never saved, for tests and a missing data directory.
    pub fn in_memory() -> Self {
        Self {
            path: None,
            current: Mutex::new(Settings::default()),
        }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().expect("settings mutex").clone()
    }

    /// Merges `patch`, saves, and returns the result. Nothing changes if the
    /// patch is invalid or the file cannot be written.
    pub fn update(&self, patch: serde_json::Value) -> Result<Settings, String> {
        let mut current = self.current.lock().expect("settings mutex");
        let next = current.merge(patch)?;
        if let Some(path) = &self.path {
            save(path, &next)?;
        }
        *current = next.clone();
        Ok(next)
    }
}

/// Parses a saved file, moving settings an older build wrote under another
/// name to where this one reads them.
fn read(bytes: &[u8]) -> serde_json::Result<Settings> {
    let mut value: serde_json::Value = serde_json::from_slice(bytes)?;
    if let Some(fields) = value.as_object_mut() {
        // The search history switch was once a pause, on or off. Paused meant
        // nothing recorded anywhere, which is Off now.
        let paused = fields.remove("pauseSearchHistory");
        if let (Some(serde_json::Value::Bool(paused)), false) =
            (paused, fields.contains_key("searchHistory"))
        {
            let history = if paused { "off" } else { "youtube" };
            fields.insert("searchHistory".into(), history.into());
        }
    }
    serde_json::from_value(value)
}

fn save(path: &PathBuf, settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(settings).expect("settings serialize");
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| format!("could not save settings: {error}"))?;
    }
    // Written aside and renamed over, so a crash mid-write leaves the old file.
    let partial = path.with_extension("json.partial");
    fs::write(&partial, json)
        .and_then(|()| fs::rename(&partial, path))
        .map_err(|error| format!("could not save settings: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_path(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ymusic-settings-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("settings.json")
    }

    #[test]
    fn a_missing_file_gives_the_defaults() {
        let store = SettingsStore::open(temp_path("missing"));
        assert_eq!(store.get(), Settings::default());
    }

    #[test]
    fn an_update_survives_a_restart() {
        let path = temp_path("restart");
        let store = SettingsStore::open(path.clone());
        store
            .update(json!({ "autoplay": false, "audioQuality": "low" }))
            .unwrap();

        let reopened = SettingsStore::open(path).get();
        assert!(!reopened.autoplay);
        assert_eq!(reopened.audio_quality, AudioQuality::Low);
        assert!(
            reopened.check_for_updates,
            "fields the patch left out keep their value"
        );
    }

    #[test]
    fn missing_and_unknown_fields_still_load() {
        let path = temp_path("fields");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{ "stableVolume": "on", "fromTheFuture": 1 }"#).unwrap();

        let settings = SettingsStore::open(path).get();
        assert_eq!(settings.stable_volume, StableVolume::On);
        assert!(settings.autoplay);
    }

    #[test]
    fn a_saved_pause_on_search_history_becomes_off() {
        let read = |json: &str| read(json.as_bytes()).unwrap().search_history;
        assert_eq!(
            read(r#"{ "pauseSearchHistory": true }"#),
            SearchHistory::Off
        );
        assert_eq!(
            read(r#"{ "pauseSearchHistory": false }"#),
            SearchHistory::Youtube
        );
        assert_eq!(read("{}"), SearchHistory::Youtube);
        assert_eq!(
            read(r#"{ "pauseSearchHistory": true, "searchHistory": "device" }"#),
            SearchHistory::Device,
            "a choice already made wins over the old switch"
        );
    }

    #[test]
    fn a_corrupt_file_gives_the_defaults() {
        let path = temp_path("corrupt");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(SettingsStore::open(path).get(), Settings::default());
    }

    #[test]
    fn a_bad_patch_changes_nothing() {
        let store = SettingsStore::in_memory();
        assert!(store.update(json!({ "autoplay": "yes" })).is_err());
        assert!(store.update(json!({ "noSuchSetting": true })).is_err());
        assert!(store.update(json!(["autoplay"])).is_err());
        assert_eq!(store.get(), Settings::default());
    }
}
