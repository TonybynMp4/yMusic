//! Per-platform behaviour behind one API each, so feature code never grows
//! `#[cfg]` branches. Each concern gets a module with the same surface on every
//! target and a no-op or fallback where the platform has nothing to offer.

pub mod media;
pub mod window;

/// Which package this build was produced as. The Linux updater needs it: a
/// `.deb` install updates through `pkexec dpkg -i`, while a hand-run binary or
/// a future Flatpak must be told to update through its own channel instead of
/// being handed a package it cannot install.
///
/// Set at build time via `YMUSIC_INSTALL_FLAVOR`; `Unknown` is the honest default
/// for a `cargo run`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallFlavor {
    Deb,
    WindowsInstaller,
    Unknown,
}

impl InstallFlavor {
    pub fn current() -> Self {
        match option_env!("YMUSIC_INSTALL_FLAVOR") {
            Some("deb") => Self::Deb,
            Some("windows-installer") => Self::WindowsInstaller,
            _ => Self::Unknown,
        }
    }

    /// Whether the in-app updater may install an update itself, rather than
    /// only pointing the user at a download.
    pub fn supports_in_app_update(self) -> bool {
        match self {
            Self::Deb => cfg!(target_os = "linux") && which_pkexec().is_some(),
            Self::WindowsInstaller => cfg!(target_os = "windows"),
            Self::Unknown => false,
        }
    }
}

/// A desktop without polkit cannot apply a `.deb` update unattended. Detect it
/// up front so the UI can say "reinstall the newer package by hand" instead of
/// failing partway through an install.
pub fn which_pkexec() -> Option<std::path::PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|dir| dir.join("pkexec"))
            .find(|candidate| candidate.is_file())
    })
}
