//! "Open at login": an entry the desktop runs when the user logs in.
//!
//! The entry itself is the setting, not a field in `settings.json`, so turning
//! it off from the desktop's own startup list is respected. On Linux it is an
//! XDG autostart file, `ymusic.desktop` in `$XDG_CONFIG_HOME/autostart`. On
//! Windows it is a `yMusic` value under the user's `Run` key.
//!
//! The entry runs the binary with `--autostart`, so the launch can tell it came
//! from login and start in the tray.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

/// Passed by the login entry.
pub const ARG: &str = "--autostart";

/// Whether this process was started by the login entry.
pub fn launched_at_login() -> bool {
    std::env::args().skip(1).any(|arg| arg == ARG)
}

/// Whether the login entry is there.
pub fn is_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    imp::is_enabled(app)
}

/// Adds or removes the login entry.
pub fn set<R: Runtime>(app: &AppHandle<R>, on: bool) -> Result<(), String> {
    if on {
        imp::enable(app, &exe()?)
    } else {
        imp::disable(app)
    }
}

/// Points an existing entry at this binary, in case the app moved since it was
/// written (a reinstall to another folder). Release builds only: a dev build
/// would point it at `target/debug`.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    if cfg!(debug_assertions) {
        return;
    }
    let result = is_enabled(app).and_then(|on| if on { set(app, true) } else { Ok(()) });
    if let Err(error) = result {
        log::warn!("could not refresh the login entry: {error}");
    }
}

fn exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|error| format!("could not find the app's binary: {error}"))
}

#[cfg(target_os = "linux")]
mod imp {
    use std::{fs, io::ErrorKind, path::Path, path::PathBuf};

    use super::*;

    fn entry<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
        let config = app
            .path()
            .config_dir()
            .map_err(|error| format!("no config directory: {error}"))?;
        Ok(config.join("autostart").join("ymusic.desktop"))
    }

    pub fn is_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
        Ok(entry(app)?.exists())
    }

    pub fn enable<R: Runtime>(app: &AppHandle<R>, exe: &Path) -> Result<(), String> {
        let path = entry(app)?;
        let contents = desktop_file(exe);
        if fs::read_to_string(&path).is_ok_and(|current| current == contents) {
            return Ok(());
        }
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        }
        fs::write(&path, contents).map_err(|error| format!("{}: {error}", path.display()))
    }

    pub fn disable<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
        let path = entry(app)?;
        match fs::remove_file(&path) {
            Err(error) if error.kind() != ErrorKind::NotFound => {
                Err(format!("{}: {error}", path.display()))
            }
            _ => Ok(()),
        }
    }

    pub(super) fn desktop_file(exe: &Path) -> String {
        format!(
            "[Desktop Entry]\n\
             Type=Application\n\
             Name=yMusic\n\
             Comment=A native YouTube Music player\n\
             Exec={} {}\n\
             Icon=ymusic\n\
             Terminal=false\n\
             StartupNotify=false\n\
             X-GNOME-Autostart-enabled=true\n",
            exec_arg(&exe.to_string_lossy()),
            super::ARG,
        )
    }

    /// Quotes an `Exec` argument as the desktop entry spec asks: inside double
    /// quotes, `"`, `` ` ``, `$` and `\` take a backslash. The key's value is a
    /// string, whose own escaping doubles each backslash again.
    pub(super) fn exec_arg(arg: &str) -> String {
        let mut quoted = String::from("\"");
        for c in arg.chars() {
            match c {
                '"' | '`' | '$' => {
                    quoted.push_str("\\\\");
                    quoted.push(c);
                }
                '\\' => quoted.push_str("\\\\\\\\"),
                _ => quoted.push(c),
            }
        }
        quoted.push('"');
        quoted
    }
}

#[cfg(windows)]
mod imp {
    use std::path::Path;

    use windows_registry::CURRENT_USER;

    use super::*;

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const NAME: &str = "yMusic";

    pub fn is_enabled<R: Runtime>(_app: &AppHandle<R>) -> Result<bool, String> {
        Ok(CURRENT_USER
            .open(RUN)
            .and_then(|key| key.get_string(NAME))
            .is_ok())
    }

    pub fn enable<R: Runtime>(_app: &AppHandle<R>, exe: &Path) -> Result<(), String> {
        // Quoted, or a path under `Program Files` is split at the space.
        let command = format!("\"{}\" {}", exe.display(), super::ARG);
        CURRENT_USER
            .create(RUN)
            .and_then(|key| key.set_string(NAME, &command))
            .map_err(|error| error.to_string())
    }

    pub fn disable<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
        let key = CURRENT_USER
            .create(RUN)
            .map_err(|error| error.to_string())?;
        if key.get_string(NAME).is_err() {
            return Ok(());
        }
        key.remove_value(NAME).map_err(|error| error.to_string())
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod imp {
    use std::path::Path;

    use super::*;

    pub fn is_enabled<R: Runtime>(_app: &AppHandle<R>) -> Result<bool, String> {
        Ok(false)
    }

    pub fn enable<R: Runtime>(_app: &AppHandle<R>, _exe: &Path) -> Result<(), String> {
        Err("opening at login is not supported on this platform".into())
    }

    pub fn disable<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::imp::{desktop_file, exec_arg};

    #[test]
    fn quotes_the_exec_path() {
        assert_eq!(exec_arg("/usr/bin/ymusic"), r#""/usr/bin/ymusic""#);
        assert_eq!(exec_arg("/opt/my apps/ymusic"), r#""/opt/my apps/ymusic""#);
        assert_eq!(exec_arg(r#"/a"b$c"#), r#""/a\\"b\\$c""#);
        assert_eq!(exec_arg(r"/a\b"), r#""/a\\\\b""#);
    }

    #[test]
    fn runs_with_the_login_flag() {
        let file = desktop_file(std::path::Path::new("/usr/bin/ymusic"));
        assert!(file.contains("\nExec=\"/usr/bin/ymusic\" --autostart\n"));
    }
}
