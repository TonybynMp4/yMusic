//! Writing the app's own data files.

use std::{fs, io, path::Path};

/// Writes `bytes` aside and renames them over `path`, so a crash mid-write
/// leaves the old file. Creates the directory if it is missing.
pub fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut partial = path.as_os_str().to_owned();
    partial.push(".partial");
    fs::write(&partial, bytes)?;
    fs::rename(&partial, path)
}
