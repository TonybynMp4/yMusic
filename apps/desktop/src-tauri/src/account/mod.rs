//! The signed-in YouTube account.
//!
//! What YouTube accepts as a session is a cookie header — see `sign_in` for
//! why it is not an OAuth token — and that header is the whole credential, so
//! it is kept encrypted at rest.
//!
//! It does not go into the OS keyring directly: Windows Credential Manager
//! refuses secrets over 2560 bytes, and a Google cookie header runs close to
//! that and grows whenever Google adds a cookie. The keyring holds a random key
//! instead, and the cookie sits beside the app's other data, sealed with it.
//! Deleting either one signs the user out, which is the right failure.

pub mod sign_in;

use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    ChaCha20Poly1305, Key, Nonce,
};
use std::{
    fs,
    io::ErrorKind,
    path::PathBuf,
    sync::Mutex,
};

const NONCE_LEN: usize = 12;

/// Where the sealing key lives. The OS keyring in the app; memory in tests,
/// which have no Secret Service to talk to.
pub trait KeyStore: Send + Sync + 'static {
    fn get(&self) -> Result<Option<Vec<u8>>, String>;
    fn set(&self, key: &[u8]) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

/// Credential Manager on Windows, the Secret Service on Linux.
pub struct OsKeyring;

impl OsKeyring {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new("ytbm", "account-key")
            .map_err(|error| format!("the system keyring is unavailable: {error}"))
    }
}

impl KeyStore for OsKeyring {
    fn get(&self) -> Result<Option<Vec<u8>>, String> {
        match Self::entry()?.get_secret() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("could not read the account key: {error}")),
        }
    }

    fn set(&self, key: &[u8]) -> Result<(), String> {
        Self::entry()?
            .set_secret(key)
            .map_err(|error| format!("could not store the account key: {error}"))
    }

    fn delete(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("could not delete the account key: {error}")),
        }
    }
}

#[derive(Default)]
pub struct MemoryKeys(Mutex<Option<Vec<u8>>>);

impl KeyStore for MemoryKeys {
    fn get(&self) -> Result<Option<Vec<u8>>, String> {
        Ok(self.0.lock().expect("key mutex").clone())
    }
    fn set(&self, key: &[u8]) -> Result<(), String> {
        *self.0.lock().expect("key mutex") = Some(key.to_vec());
        Ok(())
    }
    fn delete(&self) -> Result<(), String> {
        *self.0.lock().expect("key mutex") = None;
        Ok(())
    }
}

pub struct Account {
    path: PathBuf,
    keys: Box<dyn KeyStore>,
    cookie: Mutex<Option<String>>,
}

impl Account {
    /// Loads a saved session if there is one. Anything unreadable — a missing
    /// key, a corrupt file, a keyring that will not answer — starts the app
    /// signed out rather than failing it: signing in again is cheap.
    pub fn open(path: PathBuf, keys: impl KeyStore) -> Self {
        let account = Self { path, keys: Box::new(keys), cookie: Mutex::new(None) };
        match account.load() {
            Ok(cookie) => *account.cookie.lock().expect("cookie mutex") = cookie,
            Err(error) => log::warn!("starting signed out: {error}"),
        }
        account
    }

    pub fn cookie(&self) -> Option<String> {
        self.cookie.lock().expect("cookie mutex").clone()
    }

    /// Keeps the session for this run even if it cannot be persisted — a
    /// keyring that refuses is logged, and the user is simply asked to sign in
    /// again next launch instead of being refused now.
    pub fn save(&self, cookie: String) {
        if let Err(error) = self.persist(&cookie) {
            log::error!("signed in for this session only: {error}");
        }
        *self.cookie.lock().expect("cookie mutex") = Some(cookie);
    }

    pub fn clear(&self) -> Result<(), String> {
        *self.cookie.lock().expect("cookie mutex") = None;
        match fs::remove_file(&self.path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(format!("could not delete the saved session: {error}")),
        }
        self.keys.delete()
    }

    fn load(&self) -> Result<Option<String>, String> {
        let sealed = match fs::read(&self.path) {
            Ok(sealed) => sealed,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("could not read the saved session: {error}")),
        };
        let Some(key) = self.keys.get()? else {
            return Err("the saved session's key is gone from the keyring".into());
        };
        open_sealed(&key, &sealed).map(Some)
    }

    fn persist(&self, cookie: &str) -> Result<(), String> {
        let key = match self.keys.get()? {
            Some(key) if key.len() == 32 => key,
            _ => {
                let key = ChaCha20Poly1305::generate_key(&mut OsRng).to_vec();
                self.keys.set(&key)?;
                key
            }
        };
        let sealed = seal(&key, cookie)?;
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|error| format!("could not create {dir:?}: {error}"))?;
        }
        // Written aside and renamed over, so a crash mid-write leaves the old
        // session rather than half of a new one.
        let partial = self.path.with_extension("partial");
        fs::write(&partial, sealed)
            .and_then(|()| fs::rename(&partial, &self.path))
            .map_err(|error| format!("could not save the session: {error}"))
    }
}

fn seal(key: &[u8], plaintext: &str) -> Result<Vec<u8>, String> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|_| "could not encrypt the session".to_string())?;
    Ok([nonce.as_slice(), &ciphertext].concat())
}

fn open_sealed(key: &[u8], sealed: &[u8]) -> Result<String, String> {
    if key.len() != 32 || sealed.len() < NONCE_LEN {
        return Err("the saved session is malformed".into());
    }
    let (nonce, ciphertext) = sealed.split_at(NONCE_LEN);
    let plaintext = ChaCha20Poly1305::new(Key::from_slice(key))
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| "the saved session does not match its key".to_string())?;
    String::from_utf8(plaintext).map_err(|_| "the saved session is not text".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// Shares one key store between two `Account`s, the way two launches of the
    /// app share the OS keyring.
    #[derive(Clone, Default)]
    struct SharedKeys(Arc<MemoryKeys>);

    impl KeyStore for SharedKeys {
        fn get(&self) -> Result<Option<Vec<u8>>, String> {
            self.0.get()
        }
        fn set(&self, key: &[u8]) -> Result<(), String> {
            self.0.set(key)
        }
        fn delete(&self) -> Result<(), String> {
            self.0.delete()
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ytbm-account-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("account.bin")
    }

    #[test]
    fn a_session_survives_a_restart_and_is_not_stored_in_the_clear() {
        let path = temp_path("restart");
        let keys = SharedKeys::default();
        let cookie = "SAPISID=abc/def; __Secure-3PAPISID=abc/def";

        Account::open(path.clone(), keys.clone()).save(cookie.into());
        let on_disk = fs::read(&path).unwrap();
        assert!(!String::from_utf8_lossy(&on_disk).contains("SAPISID"));

        assert_eq!(Account::open(path, keys).cookie().as_deref(), Some(cookie));
    }

    #[test]
    fn losing_the_key_starts_signed_out() {
        let path = temp_path("lost-key");
        Account::open(path.clone(), SharedKeys::default()).save("SAPISID=x".into());
        assert_eq!(Account::open(path, SharedKeys::default()).cookie(), None);
    }

    #[test]
    fn signing_out_removes_the_file_and_the_key() {
        let path = temp_path("sign-out");
        let keys = SharedKeys::default();
        let account = Account::open(path.clone(), keys.clone());
        account.save("SAPISID=x".into());
        account.clear().unwrap();

        assert_eq!(account.cookie(), None);
        assert!(!path.exists());
        assert_eq!(keys.get().unwrap(), None);
        // And a second sign-out of nothing is not an error.
        account.clear().unwrap();
    }

    #[test]
    fn a_tampered_file_starts_signed_out() {
        let path = temp_path("tampered");
        let keys = SharedKeys::default();
        Account::open(path.clone(), keys.clone()).save("SAPISID=x".into());
        let mut sealed = fs::read(&path).unwrap();
        *sealed.last_mut().unwrap() ^= 1;
        fs::write(&path, sealed).unwrap();

        assert_eq!(Account::open(path, keys).cookie(), None);
    }
}
