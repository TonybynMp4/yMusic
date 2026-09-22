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
    /// A profile's `Cookies` database, and the name the browser most likely
    /// files its key under in the keyring ("Chrome" for "Chrome Safe Storage").
    #[cfg(target_os = "linux")]
    Chromium { cookies: PathBuf, keyring: String },
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
            .flat_map(|root| chromium::profiles(root, &keyring))
            .collect();
        found.extend(labelled(&name, stores));
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

    /// Chromium-family browsers, the name their key most likely goes by in
    /// the keyring, and where they keep their profiles. Any folder with a
    /// Chromium profile list counts, so forks nobody listed here (Helium,
    /// Thorium, ungoogled builds) turn up too. Electron apps keep the same
    /// files but no profile list, which leaves them out.
    pub fn roots(home: &Path) -> Vec<(String, String, Vec<PathBuf>)> {
        let mut bases = vec![config_dir(home)];
        for (dir, sub) in [(".var/app", "config"), ("snap", "common")] {
            if let Ok(apps) = fs::read_dir(home.join(dir)) {
                bases.extend(apps.flatten().map(|app| app.path().join(sub)));
            }
        }
        // Brave nests its profiles a folder deeper than the rest.
        let children = |dir: &Path| -> Vec<PathBuf> {
            fs::read_dir(dir)
                .map(|entries| entries.flatten().map(|e| e.path()).collect())
                .unwrap_or_default()
        };
        let mut found: Vec<(String, String, Vec<PathBuf>)> = Vec::new();
        for folder in bases
            .iter()
            .flat_map(|base| children(base))
            .flat_map(|dir| {
                let nested = children(&dir);
                std::iter::once(dir).chain(nested)
            })
            .filter(|dir| !profile_names(dir).is_empty())
        {
            let (name, keyring) = identify(&folder);
            match found.iter_mut().find(|(known, ..)| *known == name) {
                Some((.., roots)) => roots.push(folder),
                None => found.push((name, keyring, vec![folder])),
            }
        }
        found.sort_by(|a, b| a.0.cmp(&b.0));
        found
    }

    /// A browser's display name and the name its keyring entry most likely
    /// uses, from the folder it keeps its profiles in.
    pub(super) fn identify(folder: &Path) -> (String, String) {
        let dir = folder
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let known = match dir.to_lowercase().as_str() {
            "google-chrome" => Some(("Chrome", "Chrome")),
            "google-chrome-beta" => Some(("Chrome Beta", "Chrome")),
            "google-chrome-unstable" => Some(("Chrome Dev", "Chrome")),
            "chromium" => Some(("Chromium", "Chromium")),
            "brave-browser" => Some(("Brave", "Brave")),
            "microsoft-edge" => Some(("Edge", "Microsoft Edge")),
            // Vivaldi and Opera reuse Chrome's and Chromium's keyring entries.
            "vivaldi" => Some(("Vivaldi", "Chrome")),
            "opera" => Some(("Opera", "Chromium")),
            _ => None,
        };
        if let Some((name, keyring)) = known {
            return (name.into(), keyring.into());
        }
        // "net.imput.helium" is Helium, "thorium" is Thorium.
        let name: String = dir
            .rsplit('.')
            .next()
            .unwrap_or(&dir)
            .split(['-', '_'])
            .filter(|word| !word.is_empty())
            .map(|word| {
                let mut chars = word.chars();
                chars
                    .next()
                    .map(|first| first.to_uppercase().chain(chars).collect::<String>())
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join(" ");
        (name.clone(), name)
    }

    /// The profile folders `Local State` lists, with the names the browser
    /// shows for them.
    fn profile_names(root: &Path) -> HashMap<String, String> {
        fs::read_to_string(root.join("Local State"))
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
            .unwrap_or_default()
    }

    /// The profiles in a browser's folder that have a cookie database, named
    /// as the browser names them.
    pub fn profiles(root: &Path, keyring: &str) -> Vec<(String, Store)> {
        let names = profile_names(root);
        let mut dirs: Vec<&String> = names.keys().collect();
        dirs.sort();
        dirs.into_iter()
            .filter_map(|dir| {
                let profile = root.join(dir);
                // Chromium moved the database into `Network` in version 96.
                let cookies = [profile.join("Network/Cookies"), profile.join("Cookies")]
                    .into_iter()
                    .find(|path| path.is_file())?;
                let store = Store::Chromium {
                    cookies,
                    keyring: keyring.to_string(),
                };
                Some((names[dir].clone(), store))
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
        let hashed = version >= 24;
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
        let mut wanted = Vec::new();
        for row in rows {
            let (name, value, encrypted, host, path, expires) =
                row.map_err(|error| error.to_string())?;
            // Microseconds since 1601; zero is a session cookie.
            let expires = expires / 1_000_000 - 11_644_473_600;
            if applies_to_music(&host, &path) && (expires <= 0 || expires > now) {
                wanted.push((name, value, encrypted, host));
            }
        }

        // `v10` is Chromium's fixed fallback password, used without a keyring;
        // `v11` one kept in the keyring. Either may also be the empty
        // password, which some builds use when the keyring fails.
        let mut keys = Vec::new();
        for (prefix, passwords) in [
            (b"v10", vec![b"peanuts".to_vec(), Vec::new()]),
            (b"v11", Vec::new()),
        ] {
            let values: Vec<_> = wanted
                .iter()
                .filter(|(_, _, encrypted, _)| encrypted.starts_with(prefix))
                .map(|(_, _, encrypted, host)| (&encrypted[3..], host.as_str()))
                .collect();
            if values.is_empty() {
                continue;
            }
            let passwords = if prefix == b"v11" {
                let mut stored = keyring_passwords(keyring)?;
                stored.push(Vec::new());
                stored
            } else {
                passwords
            };
            // Several apps can file a key under the same label, so the right
            // one is the key that opens every value.
            let key = passwords
                .iter()
                .map(|password| derive(password))
                .find(|key| {
                    values.iter().all(|(data, host)| {
                        decrypt_with(key, data, hashed.then_some(*host)).is_some()
                    })
                })
                .ok_or("none of the keyring's keys opens the cookies")?;
            keys.push((prefix, key));
        }

        wanted
            .into_iter()
            .map(|(name, value, encrypted, host)| {
                if encrypted.is_empty() {
                    return Ok(Cookie::new(name, value));
                }
                let (_, key) = keys
                    .iter()
                    .find(|(prefix, _)| encrypted.starts_with(*prefix))
                    .ok_or("a cookie is encrypted in an unknown way")?;
                decrypt_with(key, &encrypted[3..], hashed.then_some(host.as_str()))
                    .map(|value| Cookie::new(name, value))
                    .ok_or_else(|| "could not decrypt the cookies".to_string())
            })
            .collect()
    }

    pub(super) fn derive(password: &[u8]) -> [u8; 16] {
        pbkdf2::pbkdf2_hmac_array::<sha1::Sha1, 16>(password, b"saltysalt", 1)
    }

    /// Decrypts one value. When the database hashes domains, `host` is the
    /// cookie's, and the hash must match it: a wrong key passes the padding
    /// check one time in 256, but never this.
    pub(super) fn decrypt_with(key: &[u8; 16], data: &[u8], host: Option<&str>) -> Option<String> {
        use sha2::{Digest, Sha256};
        let mut buffer = data.to_vec();
        let plain = cbc::Decryptor::<aes::Aes128>::new(key.into(), &[b' '; 16].into())
            .decrypt_padded::<Pkcs7>(&mut buffer)
            .ok()?;
        let plain = match host {
            Some(host) => {
                let (hash, rest) = plain.split_at_checked(32)?;
                (hash == Sha256::digest(host.as_bytes()).as_slice()).then_some(rest)?
            }
            None => plain,
        };
        String::from_utf8(plain.to_vec()).ok()
    }

    /// Every Chromium key in the keyring, the likeliest first: the one
    /// labelled for this browser, then those an app filed under its name,
    /// then the rest. Chromium, Helium and Electron apps all use the label
    /// "Chromium Safe Storage", so the label alone cannot tell them apart.
    fn keyring_passwords(keyring: &str) -> Result<Vec<Vec<u8>>, String> {
        use secret_service::{blocking::SecretService, EncryptionType};
        let unavailable =
            |error: secret_service::Error| format!("the keyring is unavailable: {error}");
        let service = SecretService::connect(EncryptionType::Dh).map_err(unavailable)?;
        let label = format!("{keyring} Safe Storage");
        let application = keyring.to_lowercase();
        let mut found = Vec::new();
        for collection in service.get_all_collections().map_err(unavailable)? {
            for item in collection.get_all_items().map_err(unavailable)? {
                let Ok(attributes) = item.get_attributes() else {
                    continue;
                };
                let item_label = item.get_label().unwrap_or_default();
                let chromium = attributes
                    .get("xdg:schema")
                    .is_some_and(|schema| schema.starts_with("chrome_libsecret_os_crypt_password"))
                    || item_label.ends_with(" Safe Storage");
                if !chromium {
                    continue;
                }
                let rank = if item_label == label {
                    0
                } else if attributes.get("application") == Some(&application) {
                    1
                } else {
                    2
                };
                if item.is_locked().unwrap_or(true) {
                    item.unlock().map_err(unavailable)?;
                }
                if let Ok(secret) = item.get_secret() {
                    found.push((rank, secret));
                }
            }
        }
        found.sort_by_key(|(rank, _)| *rank);
        let mut passwords: Vec<Vec<u8>> = Vec::new();
        for (_, secret) in found {
            if !passwords.contains(&secret) {
                passwords.push(secret);
            }
        }
        if passwords.is_empty() {
            return Err(format!("\"{label}\" is not in the keyring"));
        }
        Ok(passwords)
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
            chromium::decrypt_with(&key, &encrypt(b"abc/def"), None).as_deref(),
            Some("abc/def")
        );
        use sha2::{Digest, Sha256};
        let hash = Sha256::digest(b".youtube.com");
        let hashed = encrypt(&[hash.as_slice(), b"abc/def"].concat());
        assert_eq!(
            chromium::decrypt_with(&key, &hashed, Some(".youtube.com")).as_deref(),
            Some("abc/def")
        );
        // The hash belongs to another domain, as it would after decrypting
        // with a key that only happens to pass the padding check.
        assert_eq!(
            chromium::decrypt_with(&key, &hashed, Some("music.youtube.com")),
            None
        );
        assert_eq!(
            chromium::decrypt_with(&chromium::derive(b"x"), &encrypt(b"abc"), None),
            None
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn names_chromium_browsers_by_their_folder() {
        let named = |dir: &str| chromium::identify(Path::new(dir));
        assert_eq!(
            named("/c/google-chrome"),
            ("Chrome".into(), "Chrome".into())
        );
        assert_eq!(
            named("/c/BraveSoftware/Brave-Browser"),
            ("Brave".into(), "Brave".into())
        );
        assert_eq!(
            named("/c/net.imput.helium"),
            ("Helium".into(), "Helium".into())
        );
        assert_eq!(
            named("/c/ungoogled-chromium"),
            ("Ungoogled Chromium".into(), "Ungoogled Chromium".into())
        );
    }
}
