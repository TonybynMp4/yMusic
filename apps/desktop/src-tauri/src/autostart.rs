//! "Open at login": an entry the desktop runs when the user logs in.
//!
//! The entry itself is the setting, not a field in `settings.json`, so turning
//! it off from the desktop's own startup list is respected. On Linux it is an
//! XDG autostart file, `ymusic.desktop` in `$XDG_CONFIG_HOME/autostart`. On
//! Windows it is a `yMusic` value under the user's `Run` key.
//!
//! The entry runs the binary with `--autostart`, so the launch can tell it came
//! from login and start in the tray.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

/// Passed by the login entry.
pub const ARG: &str = "--autostart";

/// Whether this platform has a login entry to write.
pub const SUPPORTED: bool = cfg!(any(target_os = "linux", windows));

/// Whether this process was started by the login entry.
pub fn launched_at_login() -> bool {
    std::env::args().skip(1).any(|arg| arg == ARG)
}

/// Whether the login entry is there and the desktop will run it.
pub fn is_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    imp::is_enabled(app)
}

/// Adds or removes the login entry. Adding one the desktop had turned off
/// turns it back on.
pub fn set<R: Runtime>(app: &AppHandle<R>, on: bool) -> Result<(), String> {
    if on {
        imp::enable(app, &exe()?)
    } else {
        imp::disable(app)
    }
}

/// Points an enabled entry at this binary when the one it names is gone, as
/// after a reinstall to another folder. A path that still works is left
/// alone, since it may be a symlink or launcher chosen on purpose. Release
/// builds only: a dev build would point it at `target/debug`.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    if cfg!(debug_assertions) {
        return;
    }
    let result = is_enabled(app).and_then(|on| {
        let stale = on && imp::recorded_exe(app)?.is_some_and(|path| !path.exists());
        if stale {
            set(app, true)
        } else {
            Ok(())
        }
    });
    if let Err(error) = result {
        tracing::warn!(%error, "could not refresh the login entry");
    }
}

/// The path that starts this app. An AppImage runs from a mount that changes
/// each launch, so its entry names the AppImage file instead.
fn exe() -> Result<PathBuf, String> {
    if let Some(appimage) = std::env::var_os("APPIMAGE").filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(appimage));
    }
    std::env::current_exe().map_err(|error| format!("could not find the app's binary: {error}"))
}

#[cfg(target_os = "linux")]
mod imp {
    use std::{fs, io::ErrorKind};

    use super::*;

    fn entry<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
        let config = app
            .path()
            .config_dir()
            .map_err(|error| format!("no config directory: {error}"))?;
        Ok(config.join("autostart").join("ymusic.desktop"))
    }

    fn read<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>, String> {
        let path = entry(app)?;
        match fs::read_to_string(&path) {
            Ok(contents) => Ok(Some(contents)),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("{}: {error}", path.display())),
        }
    }

    pub fn is_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
        Ok(read(app)?.is_some_and(|contents| runs(&contents)))
    }

    pub fn recorded_exe<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PathBuf>, String> {
        Ok(read(app)?.and_then(|contents| exec_path(&contents)))
    }

    pub fn enable<R: Runtime>(app: &AppHandle<R>, exe: &Path) -> Result<(), String> {
        let path = entry(app)?;
        let contents = desktop_file(exe);
        if read(app)?.is_some_and(|current| current == contents) {
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

    /// `TryExec` makes the desktop skip the entry once the binary is gone, so
    /// uninstalling leaves nothing that fails at every login.
    pub(super) fn desktop_file(exe: &Path) -> String {
        let exe = exe.to_string_lossy();
        format!(
            "[Desktop Entry]\n\
             Type=Application\n\
             Name=yMusic\n\
             Comment=A native YouTube Music player\n\
             TryExec={}\n\
             Exec={} {}\n\
             Icon=ymusic\n\
             Terminal=false\n\
             StartupNotify=false\n\
             X-GNOME-Autostart-enabled=true\n",
            escape_string(&exe),
            escape_string(&quote_exec(&exe)),
            super::ARG,
        )
    }

    /// Whether the desktop will run the entry. Some desktops turn an entry
    /// off by keeping the file and marking it rather than deleting it.
    pub(super) fn runs(contents: &str) -> bool {
        !entry_lines(contents).any(|(key, value)| {
            (key == "Hidden" && value == "true")
                || (key == "X-GNOME-Autostart-enabled" && value == "false")
        })
    }

    /// The binary an entry starts: `Exec`'s first argument.
    pub(super) fn exec_path(contents: &str) -> Option<PathBuf> {
        let (_, value) = entry_lines(contents).find(|(key, _)| *key == "Exec")?;
        let value = unescape_string(value);
        let mut path = String::new();
        if let Some(quoted) = value.strip_prefix('"') {
            let mut chars = quoted.chars();
            loop {
                match chars.next()? {
                    '"' => break,
                    '\\' => path.push(chars.next()?),
                    c => path.push(c),
                }
            }
        } else {
            path = value.split(' ').next()?.to_string();
        }
        Some(PathBuf::from(path.replace("%%", "%")))
    }

    /// The `key=value` lines of the `[Desktop Entry]` group.
    fn entry_lines(contents: &str) -> impl Iterator<Item = (&str, &str)> {
        let mut in_entry = false;
        contents.lines().filter_map(move |line| {
            let line = line.trim();
            if line.starts_with('[') {
                in_entry = line == "[Desktop Entry]";
                return None;
            }
            if !in_entry {
                return None;
            }
            let (key, value) = line.split_once('=')?;
            Some((key.trim(), value.trim()))
        })
    }

    /// Quotes an `Exec` argument as the desktop entry spec asks: inside double
    /// quotes, `"`, `` ` ``, `$` and `\` take a backslash, and a literal `%`
    /// is written `%%` so it is not read as a field code.
    pub(super) fn quote_exec(arg: &str) -> String {
        let mut quoted = String::from("\"");
        for c in arg.chars() {
            match c {
                '"' | '`' | '$' | '\\' => {
                    quoted.push('\\');
                    quoted.push(c);
                }
                '%' => quoted.push_str("%%"),
                _ => quoted.push(c),
            }
        }
        quoted.push('"');
        quoted
    }

    /// A desktop entry string value doubles each backslash.
    fn escape_string(value: &str) -> String {
        value.replace('\\', "\\\\")
    }

    fn unescape_string(value: &str) -> String {
        let mut out = String::new();
        let mut chars = value.chars();
        while let Some(c) = chars.next() {
            if c != '\\' {
                out.push(c);
                continue;
            }
            match chars.next() {
                Some('s') => out.push(' '),
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some(other) => out.push(other),
                None => out.push('\\'),
            }
        }
        out
    }
}

#[cfg(windows)]
mod imp {
    use windows_registry::{Type, CURRENT_USER};

    use super::*;

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    /// Where Task Manager's Startup tab records an entry it turned off,
    /// without touching `Run`.
    const APPROVED: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    const NAME: &str = "yMusic";
    /// What Windows writes there for an entry that is on.
    const APPROVED_ON: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    fn command<R: Runtime>(_app: &AppHandle<R>) -> Option<String> {
        CURRENT_USER
            .open(RUN)
            .and_then(|key| key.get_string(NAME))
            .ok()
    }

    /// An odd first byte means Task Manager turned the entry off.
    fn approved() -> bool {
        match CURRENT_USER
            .open(APPROVED)
            .and_then(|key| key.get_value(NAME))
        {
            Ok(value) => value.first().is_none_or(|flag| flag & 1 == 0),
            Err(_) => true,
        }
    }

    pub fn is_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
        Ok(command(app).is_some() && approved())
    }

    pub fn recorded_exe<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PathBuf>, String> {
        Ok(command(app).and_then(|command| {
            let quoted = command.strip_prefix('"')?;
            let (path, _) = quoted.split_once('"')?;
            Some(PathBuf::from(path))
        }))
    }

    pub fn enable<R: Runtime>(_app: &AppHandle<R>, exe: &Path) -> Result<(), String> {
        // Quoted, or a path under `Program Files` is split at the space.
        let command = format!("\"{}\" {}", exe.display(), super::ARG);
        CURRENT_USER
            .create(RUN)
            .and_then(|key| key.set_string(NAME, &command))
            .map_err(|error| error.to_string())?;
        if !approved() {
            CURRENT_USER
                .create(APPROVED)
                .and_then(|key| key.set_bytes(NAME, Type::Bytes, &APPROVED_ON))
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub fn disable<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
        for path in [RUN, APPROVED] {
            let Ok(key) = CURRENT_USER.create(path) else {
                continue;
            };
            if key.get_value(NAME).is_ok() {
                key.remove_value(NAME).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod imp {
    use super::*;

    pub fn is_enabled<R: Runtime>(_app: &AppHandle<R>) -> Result<bool, String> {
        Ok(false)
    }

    pub fn recorded_exe<R: Runtime>(_app: &AppHandle<R>) -> Result<Option<PathBuf>, String> {
        Ok(None)
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
    use std::path::{Path, PathBuf};

    use super::imp::{desktop_file, exec_path, quote_exec, runs};

    #[test]
    fn quotes_the_exec_path() {
        assert_eq!(quote_exec("/usr/bin/ymusic"), r#""/usr/bin/ymusic""#);
        assert_eq!(
            quote_exec("/opt/my apps/ymusic"),
            r#""/opt/my apps/ymusic""#
        );
        assert_eq!(quote_exec(r#"/a"b$c"#), r#""/a\"b\$c""#);
        assert_eq!(quote_exec("/a%20b"), r#""/a%%20b""#);
    }

    #[test]
    fn runs_with_the_login_flag() {
        let file = desktop_file(Path::new("/usr/bin/ymusic"));
        assert!(file.contains("\nTryExec=/usr/bin/ymusic\n"));
        assert!(file.contains("\nExec=\"/usr/bin/ymusic\" --autostart\n"));
        assert!(runs(&file));
    }

    #[test]
    fn reads_back_the_path_it_wrote() {
        for path in ["/usr/bin/ymusic", r"/odd\dir/a b/$x%f/ymusic"] {
            let file = desktop_file(Path::new(path));
            assert_eq!(exec_path(&file), Some(PathBuf::from(path)));
        }
        let unquoted = "[Desktop Entry]\nExec=/usr/bin/ymusic --autostart\n";
        assert_eq!(exec_path(unquoted), Some(PathBuf::from("/usr/bin/ymusic")));
    }

    #[test]
    fn an_entry_marked_off_does_not_run() {
        let file = desktop_file(Path::new("/usr/bin/ymusic"));
        assert!(!runs(&format!("{file}Hidden=true\n")));
        let gnome_off = file.replace(
            "X-GNOME-Autostart-enabled=true",
            "X-GNOME-Autostart-enabled=false",
        );
        assert!(!runs(&gnome_off));
        // A key in another group is not the entry's.
        assert!(runs(&format!("{file}[Desktop Action x]\nHidden=true\n")));
    }
}
