//! Importing the YouTube session from a browser the user is already signed in to.
//!
//! This is the same cookie session the sign-in window collects (see `sign_in`),
//! read from the browser's cookie store on disk instead. Firefox and its forks
//! keep cookies in the clear. Chromium browsers encrypt them, on Linux with a
//! key this can read from the Secret Service. On Windows they use app-bound
//! encryption, which only the browser itself can undo, so Windows offers
//! Firefox-family browsers only.
//!
//! The session stays shared with the browser: signing out there ends it here
//! too.

use rusqlite::{Connection, OpenFlags};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::webview::Cookie;

use super::sign_in::cookie_header;

/// A browser profile with a cookie store. The id is what the frontend sends
/// back to import it; the path behind it never leaves Rust.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Browser {
    pub id: String,
    pub name: String,
    #[serde(skip)]
    store: Store,
}

#[derive(Clone, Debug, PartialEq)]
enum Store {
    /// A profile's `cookies.sqlite`.
    Firefox(PathBuf),
    /// A profile's `Cookies` database, and the name the browser files its key
    /// under in the keyring ("Chrome" for "Chrome Safe Storage").
    #[cfg(target_os = "linux")]
    Chromium {
        cookies: PathBuf,
        keyring: &'static str,
    },
}

/// Every browser profile on this machine that has a cookie store.
pub fn browsers() -> Vec<Browser> {
    let home = home_dir();
    let mut found = Vec::new();
    for (name, roots) in firefox_roots(&home) {
        let stores: Vec<_> = roots
            .iter()
            .flat_map(|root| firefox_profiles(root))
            .collect();
        found.extend(labelled(name, stores));
    }
    #[cfg(target_os = "linux")]
    for (name, keyring, roots) in chromium::roots(&home) {
        let stores: Vec<_> = roots
            .iter()
            .flat_map(|root| chromium::profiles(root, keyring))
            .collect();
        found.extend(labelled(name, stores));
    }
    found
}

/// Reads the session out of one of `browsers()`, by its id.
pub fn import(id: &str) -> Result<String, String> {
    let browser = browsers()
        .into_iter()
        .find(|b| b.id == id)
        .ok_or("that browser profile is gone")?;
    let cookies = match &browser.store {
        Store::Firefox(path) => read_firefox(path),
        #[cfg(target_os = "linux")]
        Store::Chromium { cookies, keyring } => chromium::read(cookies, keyring),
    }
    .map_err(|error| format!("could not read {}'s cookies: {error}", browser.name))?;
    cookie_header(&cookies).ok_or_else(|| format!("{} is not signed in to YouTube", browser.name))
}

/// Names each profile after its browser, adding the profile's own name only
/// when the browser has more than one.
fn labelled(browser: &str, stores: Vec<(String, Store)>) -> Vec<Browser> {
    let single = stores.len() == 1;
    stores
        .into_iter()
        .map(|(profile, store)| Browser {
            id: store_path(&store).to_string_lossy().into_owned(),
            name: if single {
                browser.to_string()
            } else {
                format!("{browser} ({profile})")
            },
            store,
        })
        .collect()
}

fn store_path(store: &Store) -> &Path {
    match store {
        Store::Firefox(path) => path,
        #[cfg(target_os = "linux")]
        Store::Chromium { cookies, .. } => cookies,
    }
}

fn home_dir() -> PathBuf {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME");
    home.map(PathBuf::from).unwrap_or_default()
}

/// The folders holding each Firefox-family browser's `profiles.ini`, including
/// the Snap and Flatpak packages.
fn firefox_roots(home: &Path) -> Vec<(&'static str, Vec<PathBuf>)> {
    #[cfg(windows)]
    {
        let appdata = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Roaming"));
        vec![
            ("Firefox", vec![appdata.join("Mozilla/Firefox")]),
            ("LibreWolf", vec![appdata.join("librewolf")]),
            ("Zen", vec![appdata.join("zen")]),
            ("Floorp", vec![appdata.join("Floorp")]),
            ("Waterfox", vec![appdata.join("Waterfox")]),
        ]
    }
    #[cfg(not(windows))]
    {
        let config = config_dir(home);
        let flatpak = |app: &str, dir: &str| home.join(".var/app").join(app).join(dir);
        vec![
            (
                "Firefox",
                vec![
                    home.join(".mozilla/firefox"),
                    config.join("mozilla/firefox"),
                    home.join("snap/firefox/common/.mozilla/firefox"),
                    flatpak("org.mozilla.firefox", ".mozilla/firefox"),
                    flatpak("org.mozilla.firefox", "config/mozilla/firefox"),
                ],
            ),
            (
                "LibreWolf",
                vec![
                    home.join(".librewolf"),
                    flatpak("io.gitlab.librewolf-community", ".librewolf"),
                ],
            ),
            (
                "Zen",
                vec![home.join(".zen"), flatpak("app.zen_browser.zen", ".zen")],
            ),
            (
                "Floorp",
                vec![
                    home.join(".floorp"),
                    flatpak("one.ablaze.floorp", ".floorp"),
                ],
            ),
            ("Waterfox", vec![home.join(".waterfox")]),
        ]
    }
}

#[cfg(not(windows))]
fn config_dir(home: &Path) -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
        .unwrap_or_else(|| home.join(".config"))
}

/// The profiles `profiles.ini` lists, by name, that have a cookie store.
fn firefox_profiles(root: &Path) -> Vec<(String, Store)> {
    let Ok(ini) = fs::read_to_string(root.join("profiles.ini")) else {
        return Vec::new();
    };
    let mut profiles = Vec::new();
    let mut section = Vec::<(String, String)>::new();
    let mut flush = |section: &mut Vec<(String, String)>| {
        let get = |key: &str| {
            section
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.as_str())
        };
        if let Some(path) = get("Path") {
            let dir = if get("IsRelative") == Some("0") {
                PathBuf::from(path)
            } else {
                root.join(path)
            };
            let cookies = dir.join("cookies.sqlite");
            if cookies.is_file() {
                let name = get("Name").unwrap_or(path).to_string();
                profiles.push((name, Store::Firefox(cookies)));
            }
        }
        section.clear();
    };
    let mut in_profile = false;
    for line in ini.lines().map(str::trim) {
        if line.starts_with('[') {
            flush(&mut section);
            in_profile = line.starts_with("[Profile");
        } else if let Some((key, value)) = line.split_once('=') {
            if in_profile {
                section.push((key.trim().to_string(), value.trim().to_string()));
            }
        }
    }
    flush(&mut section);
    profiles
}

/// Whether a cookie set for `host` and `path` is sent to music.youtube.com.
fn applies_to_music(host: &str, path: &str) -> bool {
    matches!(
        host,
        ".youtube.com" | "music.youtube.com" | ".music.youtube.com"
    ) && path == "/"
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Opens a copy of a browser's cookie database. The browser may hold it open,
/// and its most recent writes may still sit in the write-ahead log beside it,
/// so both are copied to a private folder first.
fn open_copy(db: &Path) -> Result<(Connection, TempDir), String> {
    let dir = TempDir::new()?;
    let copy = dir.0.join("cookies.sqlite");
    fs::copy(db, &copy).map_err(|error| error.to_string())?;
    let mut wal = db.as_os_str().to_owned();
    wal.push("-wal");
    let _ = fs::copy(&wal, dir.0.join("cookies.sqlite-wal"));
    let connection = Connection::open_with_flags(&copy, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|error| error.to_string())?;
    Ok((connection, dir))
}

/// A folder only this user can read, removed when dropped. It briefly holds
/// the copied cookies.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Result<Self, String> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let path =
            std::env::temp_dir().join(format!("ymusic-import-{}-{nanos}", std::process::id()));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
        builder
            .create(&path)
            .map_err(|error| format!("could not create {path:?}: {error}"))?;
        Ok(Self(path))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn read_firefox(db: &Path) -> Result<Vec<Cookie<'static>>, String> {
    let (connection, _dir) = open_copy(db)?;
    // Container tabs keep their own cookies under a non-empty origin
    // attribute; the session to import is the one outside any container.
    let mut statement = connection
        .prepare(
            "SELECT name, value, host, path, expiry FROM moz_cookies WHERE originAttributes = ''",
        )
        .map_err(|error| error.to_string())?;
    let now = now_secs();
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut cookies = Vec::new();
    for row in rows {
        let (name, value, host, path, expiry) = row.map_err(|error| error.to_string())?;
        // Newer Firefox stores the expiry in milliseconds, older in seconds.
        let expiry = if expiry > 100_000_000_000 {
            expiry / 1000
        } else {
            expiry
        };
        if applies_to_music(&host, &path) && expiry > now {
            cookies.push(Cookie::new(name, value));
        }
    }
    Ok(cookies)
}

#[cfg(target_os = "linux")]
mod chromium {
    use super::*;
    use aes::cipher::{block_padding::Pkcs7, BlockModeDecrypt, KeyIvInit};
    use std::collections::HashMap;

    /// Chromium-family browsers, the name their key goes by in the keyring,
    /// and where they keep their profiles.
    pub fn roots(home: &Path) -> Vec<(&'static str, &'static str, Vec<PathBuf>)> {
        let config = config_dir(home);
        let flatpak =
            |app: &str, dir: &str| home.join(".var/app").join(app).join("config").join(dir);
        vec![
            (
                "Chrome",
                "Chrome",
                vec![
                    config.join("google-chrome"),
                    flatpak("com.google.Chrome", "google-chrome"),
                ],
            ),
            (
                "Chromium",
                "Chromium",
                vec![
                    config.join("chromium"),
                    home.join("snap/chromium/common/chromium"),
                    flatpak("org.chromium.Chromium", "chromium"),
                ],
            ),
            (
                "Brave",
                "Brave",
                vec![
                    config.join("BraveSoftware/Brave-Browser"),
                    flatpak("com.brave.Browser", "BraveSoftware/Brave-Browser"),
                ],
            ),
            (
                "Edge",
                "Microsoft Edge",
                vec![
                    config.join("microsoft-edge"),
                    flatpak("com.microsoft.Edge", "microsoft-edge"),
                ],
            ),
            // Vivaldi and Opera reuse Chrome's and Chromium's keyring entries.
            (
                "Vivaldi",
                "Chrome",
                vec![
                    config.join("vivaldi"),
                    flatpak("com.vivaldi.Vivaldi", "vivaldi"),
                ],
            ),
            ("Opera", "Chromium", vec![config.join("opera")]),
        ]
    }

    /// The profiles in a browser's folder that have a cookie database, named
    /// as the browser names them.
    pub fn profiles(root: &Path, keyring: &'static str) -> Vec<(String, Store)> {
        let names: HashMap<String, String> = fs::read_to_string(root.join("Local State"))
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|state| {
                let cache = state
                    .get("profile")?
                    .get("info_cache")?
                    .as_object()?
                    .clone();
                Some(
                    cache
                        .into_iter()
                        .filter_map(|(dir, info)| {
                            Some((dir, info.get("name")?.as_str()?.to_string()))
                        })
                        .collect(),
                )
            })
            .unwrap_or_default();
        let mut dirs: Vec<String> = names.keys().cloned().collect();
        if dirs.is_empty() {
            dirs.push("Default".into());
        }
        dirs.sort();
        dirs.into_iter()
            .filter_map(|dir| {
                let profile = root.join(&dir);
                // Chromium moved the database into `Network` in version 96.
                let cookies = [profile.join("Network/Cookies"), profile.join("Cookies")]
                    .into_iter()
                    .find(|path| path.is_file())?;
                let name = names.get(&dir).cloned().unwrap_or(dir);
                Some((name, Store::Chromium { cookies, keyring }))
            })
            .collect()
    }

    pub fn read(db: &Path, keyring: &str) -> Result<Vec<Cookie<'static>>, String> {
        let (connection, _dir) = open_copy(db)?;
        // From schema version 24, each value starts with a hash of its domain.
        let version: i64 = connection
            .query_row("SELECT value FROM meta WHERE key = 'version'", [], |row| {
                row.get::<_, String>(0)
            })
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let mut statement = connection
            .prepare(
                "SELECT name, value, encrypted_value, host_key, path, expires_utc FROM cookies",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let now = now_secs();
        let mut keys = Keys::new(keyring);
        let mut cookies = Vec::new();
        for row in rows {
            let (name, value, encrypted, host, path, expires) =
                row.map_err(|error| error.to_string())?;
            // Microseconds since 1601; zero is a session cookie.
            let expires = expires / 1_000_000 - 11_644_473_600;
            if !applies_to_music(&host, &path) || (expires > 0 && expires <= now) {
                continue;
            }
            let value = if encrypted.is_empty() {
                value
            } else {
                keys.decrypt(&encrypted, version >= 24)?
            };
            cookies.push(Cookie::new(name, value));
        }
        Ok(cookies)
    }

    /// The keys a value may be encrypted with. The keyring is asked only once
    /// a value needs it, since asking can prompt to unlock it.
    struct Keys<'a> {
        keyring: &'a str,
        stored: Option<Result<[u8; 16], String>>,
    }

    impl<'a> Keys<'a> {
        fn new(keyring: &'a str) -> Self {
            Self {
                keyring,
                stored: None,
            }
        }

        fn decrypt(&mut self, encrypted: &[u8], hashed: bool) -> Result<String, String> {
            let (version, data) = encrypted.split_at(3.min(encrypted.len()));
            // `v10` is Chromium's fixed fallback password, used without a
            // keyring; `v11` the one in the keyring. Either may also be the
            // empty password, which some builds use when the keyring fails.
            let candidates = match version {
                b"v10" => vec![derive(b"peanuts"), derive(b"")],
                b"v11" => {
                    let keyring = self.keyring;
                    let stored = self
                        .stored
                        .get_or_insert_with(|| keyring_password(keyring).map(|p| derive(&p)))
                        .clone()?;
                    vec![stored, derive(b"")]
                }
                _ => return Err("a cookie is encrypted in an unknown way".into()),
            };
            candidates
                .iter()
                .find_map(|key| decrypt_with(key, data, hashed))
                .ok_or_else(|| "could not decrypt the cookies".into())
        }
    }

    pub(super) fn derive(password: &[u8]) -> [u8; 16] {
        pbkdf2::pbkdf2_hmac_array::<sha1::Sha1, 16>(password, b"saltysalt", 1)
    }

    pub(super) fn decrypt_with(key: &[u8; 16], data: &[u8], hashed: bool) -> Option<String> {
        let mut buffer = data.to_vec();
        let plain = cbc::Decryptor::<aes::Aes128>::new(key.into(), &[b' '; 16].into())
            .decrypt_padded::<Pkcs7>(&mut buffer)
            .ok()?;
        let plain = if hashed { plain.get(32..)? } else { plain };
        String::from_utf8(plain.to_vec()).ok()
    }

    fn keyring_password(keyring: &str) -> Result<Vec<u8>, String> {
        use secret_service::{blocking::SecretService, EncryptionType};
        let unavailable =
            |error: secret_service::Error| format!("the keyring is unavailable: {error}");
        let service = SecretService::connect(EncryptionType::Dh).map_err(unavailable)?;
        let label = format!("{keyring} Safe Storage");
        for collection in service.get_all_collections().map_err(unavailable)? {
            for item in collection.get_all_items().map_err(unavailable)? {
                if item.get_label().ok().as_deref() != Some(label.as_str()) {
                    continue;
                }
                item.unlock().map_err(unavailable)?;
                return item.get_secret().map_err(unavailable);
            }
        }
        Err(format!("\"{label}\" is not in the keyring"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ymusic-import-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_firefox_profiles_and_their_youtube_session() {
        let root = temp_root("firefox");
        fs::write(
            root.join("profiles.ini"),
            "[General]\nVersion=2\n\n[Profile1]\nName=work\nIsRelative=1\nPath=abc.work\n\n\
             [Profile0]\nName=default-release\nIsRelative=1\nPath=xyz.default-release\nDefault=1\n",
        )
        .unwrap();
        fs::create_dir_all(root.join("abc.work")).unwrap();
        let profile = root.join("xyz.default-release");
        fs::create_dir_all(&profile).unwrap();
        let db = profile.join("cookies.sqlite");
        let connection = Connection::open(&db).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT,
                   expiry INTEGER, originAttributes TEXT NOT NULL DEFAULT '');",
            )
            .unwrap();
        let future = now_secs() + 3600;
        for (name, host, path, expiry, origin) in [
            ("SAPISID", ".youtube.com", "/", future, ""),
            ("LOGIN_INFO", ".youtube.com", "/", future * 1000, ""),
            ("PREF", "music.youtube.com", "/", future, ""),
            ("OLD", ".youtube.com", "/", 1, ""),
            ("SID", ".google.com", "/", future, ""),
            ("WWW", "www.youtube.com", "/", future, ""),
            ("DEEP", ".youtube.com", "/embed", future, ""),
            ("BOXED", ".youtube.com", "/", future, "^userContextId=1"),
        ] {
            connection
                .execute(
                    "INSERT INTO moz_cookies VALUES (?1, 'v', ?2, ?3, ?4, ?5)",
                    rusqlite::params![name, host, path, expiry, origin],
                )
                .unwrap();
        }
        drop(connection);

        let profiles = firefox_profiles(&root);
        assert_eq!(
            profiles,
            vec![("default-release".to_string(), Store::Firefox(db.clone()))]
        );
        let names: Vec<_> = read_firefox(&db)
            .unwrap()
            .iter()
            .map(|c| c.name().to_string())
            .collect();
        assert_eq!(names, ["SAPISID", "LOGIN_INFO", "PREF"]);
    }

    #[test]
    fn names_profiles_only_when_a_browser_has_several() {
        let store = |p: &str| Store::Firefox(PathBuf::from(p));
        let one = labelled("Firefox", vec![("default".into(), store("/a"))]);
        assert_eq!(one[0].name, "Firefox");
        let two = labelled(
            "Firefox",
            vec![
                ("default".into(), store("/a")),
                ("work".into(), store("/b")),
            ],
        );
        assert_eq!(two[1].name, "Firefox (work)");
        assert_eq!(two[1].id, "/b");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn decrypts_chromium_values() {
        use aes::cipher::{block_padding::Pkcs7, BlockModeEncrypt, KeyIvInit};
        let key = chromium::derive(b"peanuts");
        let encrypt = |plain: &[u8]| {
            let mut buffer = vec![0u8; plain.len() + 16];
            buffer[..plain.len()].copy_from_slice(plain);
            cbc::Encryptor::<aes::Aes128>::new(&key.into(), &[b' '; 16].into())
                .encrypt_padded::<Pkcs7>(&mut buffer, plain.len())
                .unwrap()
                .to_vec()
        };
        assert_eq!(
            chromium::decrypt_with(&key, &encrypt(b"abc/def"), false).as_deref(),
            Some("abc/def")
        );
        let hashed = [[7u8; 32].as_slice(), b"abc/def"].concat();
        assert_eq!(
            chromium::decrypt_with(&key, &encrypt(&hashed), true).as_deref(),
            Some("abc/def")
        );
        assert_eq!(
            chromium::decrypt_with(&chromium::derive(b"x"), &encrypt(b"abc"), false),
            None
        );
    }
}
