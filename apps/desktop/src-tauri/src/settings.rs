//! The user's settings, kept as `settings.json` beside the app's other data.
//!
//! Every field has a default and the file is laid over the defaults one field
//! at a time, so a file written by an older build (missing a field) or a newer
//! one (with a field this build does not know, or a value it cannot read)
//! still loads. A value that does not parse is logged and that one setting
//! keeps its default. A file that is not a JSON object at all is logged and
//! replaced by the defaults: losing a preference is a much better outcome than
//! a player that refuses to start.
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
        // `Serialize` is derived only to give specta the field names.
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

impl Settings {
    /// The fields of a settings file, with the defaults for fields it lacks,
    /// as one written before a setting existed does, and unknown fields
    /// ignored, as one written by a newer version may have. Each value is
    /// tried on its own, so one this build cannot read (a newer build's enum
    /// variant, say) is logged and keeps its default while the rest load.
    fn from_fields(file: serde_json::Map<String, serde_json::Value>) -> Self {
        let mut settings = Self::default();
        for (key, value) in file {
            let mut json = serde_json::to_value(&settings).expect("settings serialize");
            let fields = json.as_object_mut().expect("settings are an object");
            if !fields.contains_key(&key) {
                continue;
            }
            fields.insert(key.clone(), value);
            match serde_json::from_value(json) {
                Ok(next) => settings = next,
                Err(error) => log::warn!("ignoring saved setting `{key}`: {error}"),
            }
        }
        settings
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

    /// Applies `patch`, saves, and returns the result. Nothing changes if the
    /// file cannot be written.
    pub fn update(&self, patch: SettingsPatch) -> Result<Settings, String> {
        let mut current = self.current.lock().expect("settings mutex");
        let next = current.apply(patch);
        if let Some(path) = &self.path {
            save(path, &next)?;
        }
        *current = next.clone();
        Ok(next)
    }
}

/// Parses a saved file, moving settings an older build wrote under another
/// name to where this one reads them. Only a file that is not a JSON object
/// fails; a bad value inside one costs that setting alone.
///
/// Migrations live here, one block per change, oldest first. When a setting
/// is renamed or its values change meaning, add a block that rewrites the old
/// key or value into the new one before `from_fields` runs, and leave the
/// blocks before it alone: a file can come from any older build. A new
/// setting, or a new value for an enum, needs no migration, because a missing
/// key gets its default and an older build defaults a value it cannot read.
fn read(bytes: &[u8]) -> serde_json::Result<Settings> {
    let mut fields: serde_json::Map<String, serde_json::Value> = serde_json::from_slice(bytes)?;

    // The search history switch was once a pause, on or off. Paused meant
    // nothing recorded anywhere, which is Off now.
    let paused = fields.remove("pauseSearchHistory");
    if let (Some(serde_json::Value::Bool(paused)), false) =
        (paused, fields.contains_key("searchHistory"))
    {
        let history = if paused { "off" } else { "youtube" };
        fields.insert("searchHistory".into(), history.into());
    }

    Ok(Settings::from_fields(fields))
}

fn save(path: &std::path::Path, settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(settings).expect("settings serialize");
    crate::files::write_atomically(path, &json)
        .map_err(|error| format!("could not save settings: {error}"))
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
        let history = |json: &str| read(json.as_bytes()).unwrap().search_history;
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
        .unwrap();
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
    fn a_file_that_is_not_an_object_gives_the_defaults() {
        for json in ["[]", "true", r#""settings""#, "null"] {
            assert!(read(json.as_bytes()).is_err(), "{json}");
        }
        let path = temp_path("not-object");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"["autoplay"]"#).unwrap();
        assert_eq!(SettingsStore::open(path).get(), Settings::default());
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
