//! The user's settings, kept as `settings.json` beside the app's other data.
//!
//! Every field has a default and the file is laid over the defaults one field
//! at a time, so a file written by an older build (missing a field) or a newer
//! one (with a field this build does not know, or a value it cannot read)
//! still loads. A value that does not parse is logged and that one setting
//! keeps its default. What this build cannot use is written back on save, so
//! the newer build gets it back. A file that is not a JSON object at all is
//! logged and replaced by the defaults: losing a preference is a much better
//! outcome than a player that refuses to start.
//!
//! There is no version number. When a setting changes its name or meaning,
//! `read` gets a small migration for that one change: see the comment there.

use std::{fs, io::ErrorKind, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AudioQuality {
    #[default]
    High,
    Normal,
    Low,
}

/// How stable volume evens songs out.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
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
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
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

/// Declares `Settings`, its defaults, and `SettingsPatch`, the change
/// `settings_set` takes, from one list, so a new setting is one line here and
/// the frontend can change it.
macro_rules! settings {
    ($($(#[doc = $doc:literal])* $field:ident: $ty:ty = $default:expr,)*) => {
        #[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
        #[serde(rename_all = "camelCase")]
        pub struct Settings {
            $($(#[doc = $doc])* pub $field: $ty,)*
        }

        impl Default for Settings {
            fn default() -> Self {
                Self { $($field: $default,)* }
            }
        }

        /// The settings `settings_set` changes: each field present replaces
        /// the saved one, and the rest stay. A field sent as `null` is a wrong
        /// type, like any other, rather than a field left out.
        #[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
        #[serde(rename_all = "camelCase")]
        pub struct SettingsPatch {
            $(
                #[specta(optional, type = $ty)]
                pub $field: Option<$ty>,
            )*
        }

        // By hand, through a private struct, because `deserialize_with` on
        // the public one makes specta export a separate type per direction.
        // `Serialize` gives specta the field names, and the store the
        // names of the fields a patch sets.
        impl<'de> Deserialize<'de> for SettingsPatch {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase", deny_unknown_fields)]
                struct Fields {
                    $(
                        #[serde(default, deserialize_with = "present")]
                        $field: Option<$ty>,
                    )*
                }
                let fields = Fields::deserialize(deserializer)?;
                Ok(Self { $($field: fields.$field,)* })
            }
        }

        impl Settings {
            /// The settings with the fields present in `patch` replaced.
            pub fn apply(&self, patch: SettingsPatch) -> Self {
                let mut next = self.clone();
                $(if let Some(value) = patch.$field {
                    next.$field = value;
                })*
                next
            }
        }
    };
}

settings! {
    /// When the queue runs out, its suggestions play on.
    autoplay: bool = true,
    audio_quality: AudioQuality = AudioQuality::High,
    stable_volume: StableVolume = StableVolume::Off,
    /// An mpv `audio-device` name. `auto` follows the system's default output.
    audio_device: String = "auto".into(),
    skip_disliked: bool = false,
    pause_watch_history: bool = false,
    search_history: SearchHistory = SearchHistory::Youtube,
    /// Closing the window hides it to the tray and playback carries on.
    close_to_tray: bool = false,
    check_for_updates: bool = true,
    include_prereleases: bool = false,
    /// Loudness, peaks and the stable volume gain, measured as a song plays.
    stats_for_nerds: bool = false,
}

/// Reads a patch field that is there. A missing one is `None` through
/// `#[serde(default)]`, so `null` reaches `T` and fails as a wrong type.
fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// The settings, and what the file held that this build could not use: keys
/// it does not know and values it cannot read, from a newer build or a hand
/// edit. Those go back into the file on every save, so a downgrade followed
/// by an upgrade finds the newer build's settings where it left them.
#[derive(Debug, Default)]
struct Saved {
    settings: Settings,
    kept: serde_json::Map<String, serde_json::Value>,
}

impl Saved {
    /// A file's fields laid over the defaults: a missing key gets its
    /// default, as in a file written before the setting existed, and an
    /// unknown one is kept but not used, as in a file from a newer build. A
    /// value that does not parse for its field is logged and kept, and that
    /// field takes its default while the rest load.
    fn from_fields(file: serde_json::Map<String, serde_json::Value>) -> Self {
        let defaults = serde_json::to_value(Settings::default()).expect("settings serialize");
        let defaults = defaults.as_object().expect("settings are an object");
        let (known, kept): (serde_json::Map<_, _>, _) = file
            .into_iter()
            .partition(|(key, _)| defaults.contains_key(key));

        let mut all = defaults.clone();
        all.extend(known.clone());
        if let Ok(settings) = serde_json::from_value(all.into()) {
            return Self { settings, kept };
        }

        // Something in the file does not parse: try its values one at a time
        // to find which, and keep the rest.
        let mut saved = Self {
            settings: Settings::default(),
            kept,
        };
        for (key, value) in known {
            let mut next = serde_json::to_value(&saved.settings).expect("settings serialize");
            next[&key] = value.clone();
            match serde_json::from_value(next) {
                Ok(settings) => saved.settings = settings,
                Err(error) => {
                    log::warn!("ignoring saved setting `{key}`: {error}");
                    saved.kept.insert(key, value);
                }
            }
        }
        saved
    }

    /// A saved file, or the defaults, with the reason logged, when it is not
    /// a JSON object.
    fn load(bytes: &[u8], path: &std::path::Path) -> Self {
        read(bytes).unwrap_or_else(|error| {
            log::error!(
                "ignoring unreadable settings in {}: {error}",
                path.display()
            );
            Self::default()
        })
    }

    /// Applies `patch`. A setting it changes no longer keeps the value this
    /// build could not read.
    fn apply(&self, patch: SettingsPatch) -> Self {
        let mut kept = self.kept.clone();
        if let serde_json::Value::Object(fields) =
            serde_json::to_value(&patch).expect("settings patch serialize")
        {
            for (key, value) in fields {
                if !value.is_null() {
                    kept.remove(&key);
                }
            }
        }
        Self {
            settings: self.settings.apply(patch),
            kept,
        }
    }

    /// The file's contents: the settings, with the kept entries over them.
    fn to_json(&self) -> Vec<u8> {
        let mut json = serde_json::to_value(&self.settings).expect("settings serialize");
        let fields = json.as_object_mut().expect("settings are an object");
        fields.extend(self.kept.clone());
        serde_json::to_vec_pretty(&json).expect("settings serialize")
    }
}

/// The settings in memory and the file they persist to.
pub struct SettingsStore {
    path: Option<PathBuf>,
    current: Mutex<Saved>,
}

impl SettingsStore {
    pub fn open(path: PathBuf) -> Self {
        let current = match fs::read(&path) {
            Ok(bytes) => Saved::load(&bytes, &path),
            Err(error) if error.kind() == ErrorKind::NotFound => Saved::default(),
            Err(error) => {
                log::error!("could not read {}: {error}", path.display());
                Saved::default()
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
            current: Mutex::new(Saved::default()),
        }
    }

    pub fn get(&self) -> Settings {
        self.current
            .lock()
            .expect("settings mutex")
            .settings
            .clone()
    }

    /// Applies `patch`, saves, and returns the result. Nothing changes if the
    /// file cannot be written.
    pub fn update(&self, patch: SettingsPatch) -> Result<Settings, String> {
        let mut current = self.current.lock().expect("settings mutex");
        let next = current.apply(patch);
        if let Some(path) = &self.path {
            crate::files::write_atomically(path, &next.to_json())
                .map_err(|error| format!("could not save settings: {error}"))?;
        }
        *current = next;
        Ok(current.settings.clone())
    }
}

/// Parses a saved file, moving settings an older build wrote under another
/// name to where this one reads them. Only a file that is not a JSON object
/// fails; a bad value inside one costs that setting alone.
///
/// There is no version number. Migrations live here, one block per change,
/// oldest first. When a setting is renamed or its values change meaning, add
/// a block that rewrites the old key or value into the new one before
/// `from_fields` runs, and leave the blocks before it alone: a file can come
/// from any older build. A new setting, or a new value for an enum, needs no
/// migration, because a missing key gets its default and an older build
/// defaults a value it cannot read.
fn read(bytes: &[u8]) -> serde_json::Result<Saved> {
    let mut fields: serde_json::Map<String, serde_json::Value> = serde_json::from_slice(bytes)?;

    // The search history switch was once a pause, on or off. Paused meant
    // nothing recorded anywhere, which is Off now. A `searchHistory` this
    // build can read wins; one it cannot gives way to the pause, so history
    // someone paused is never turned back on.
    let paused = fields.remove("pauseSearchHistory");
    let chosen = fields
        .get("searchHistory")
        .is_some_and(|value| SearchHistory::deserialize(value).is_ok());
    if let (Some(serde_json::Value::Bool(paused)), false) = (paused, chosen) {
        let history = if paused { "off" } else { "youtube" };
        fields.insert("searchHistory".into(), history.into());
    }

    Ok(Saved::from_fields(fields))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn patch(json: serde_json::Value) -> SettingsPatch {
        serde_json::from_value(json).unwrap()
    }

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
            .update(patch(json!({ "autoplay": false, "audioQuality": "low" })))
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
        let history = |json: &str| read(json.as_bytes()).unwrap().settings.search_history;
        assert_eq!(
            history(r#"{ "pauseSearchHistory": true }"#),
            SearchHistory::Off
        );
        assert_eq!(
            history(r#"{ "pauseSearchHistory": false }"#),
            SearchHistory::Youtube
        );
        assert_eq!(history("{}"), SearchHistory::Youtube);
        assert_eq!(
            history(r#"{ "pauseSearchHistory": true, "searchHistory": "device" }"#),
            SearchHistory::Device,
            "a choice already made wins over the old switch"
        );
        assert_eq!(
            history(r#"{ "pauseSearchHistory": true, "searchHistory": "fromTheFuture" }"#),
            SearchHistory::Off,
            "a choice this build cannot read does not undo the pause"
        );
    }

    #[test]
    fn a_bad_value_defaults_only_that_setting() {
        let settings = read(
            br#"{
                "audioQuality": "lossless",
                "autoplay": "yes",
                "stableVolume": "loudOnly",
                "closeToTray": true,
                "audioDevice": "pipewire/speakers"
            }"#,
        )
        .unwrap()
        .settings;
        assert_eq!(
            settings.audio_quality,
            AudioQuality::High,
            "an enum value from a newer build"
        );
        assert!(settings.autoplay, "a value of the wrong type");
        assert_eq!(settings.stable_volume, StableVolume::LoudOnly);
        assert!(settings.close_to_tray);
        assert_eq!(settings.audio_device, "pipewire/speakers");
    }

    #[test]
    fn a_save_keeps_what_this_build_could_not_use() {
        let saved =
            read(br#"{ "audioQuality": "lossless", "fromTheFuture": 1, "autoplay": true }"#)
                .unwrap()
                .apply(patch(json!({ "autoplay": false })));
        let file: serde_json::Value = serde_json::from_slice(&saved.to_json()).unwrap();
        assert_eq!(file["audioQuality"], "lossless");
        assert_eq!(file["fromTheFuture"], 1);
        assert_eq!(file["autoplay"], false);
        assert_eq!(saved.settings.audio_quality, AudioQuality::High);

        let changed = saved.apply(patch(json!({ "audioQuality": "low" })));
        let file: serde_json::Value = serde_json::from_slice(&changed.to_json()).unwrap();
        assert_eq!(
            file["audioQuality"], "low",
            "a setting changed here replaces it"
        );
        assert_eq!(file["fromTheFuture"], 1);
    }

    #[test]
    fn a_file_that_is_not_an_object_gives_the_defaults() {
        for json in ["[]", "true", r#""settings""#, "null", "{ not json"] {
            let saved = Saved::load(json.as_bytes(), std::path::Path::new("settings.json"));
            assert_eq!(saved.settings, Settings::default(), "{json}");
            assert!(saved.kept.is_empty(), "{json}");
        }
    }

    #[test]
    fn a_corrupt_file_gives_the_defaults() {
        let path = temp_path("corrupt");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(SettingsStore::open(path).get(), Settings::default());
    }

    #[test]
    fn a_patch_sets_only_its_fields() {
        let next = Settings::default().apply(patch(json!({ "audioDevice": "pipewire/out" })));
        assert_eq!(next.audio_device, "pipewire/out");
        assert_eq!(
            next,
            Settings {
                audio_device: "pipewire/out".into(),
                ..Settings::default()
            }
        );
    }

    #[test]
    fn a_bad_patch_does_not_parse() {
        let parse = |json| serde_json::from_value::<SettingsPatch>(json);
        assert!(parse(json!({ "autoplay": "yes" })).is_err());
        assert!(
            parse(json!({ "audioDevice": null })).is_err(),
            "null is not a device"
        );
        assert!(parse(json!({ "noSuchSetting": true })).is_err());
        assert!(parse(json!(["autoplay"])).is_err());
        assert_eq!(parse(json!({})).unwrap(), SettingsPatch::default());
    }
}
