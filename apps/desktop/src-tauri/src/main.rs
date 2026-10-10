// Keeps the console window from flashing up alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    limit_malloc_arenas();
    ymusic_lib::run()
}

/// glibc gives each thread that allocates its own malloc arena, up to eight
/// per core, and keeps what is freed in the arena rather than returning it.
/// With mpv's, WebKit's and Tokio's threads that grew to dozens of arenas and
/// a few hundred MB that the app no longer used (docs/memory.md). Two arenas
/// keep threads from contending on one lock without the waste.
///
/// `mallopt` covers this process and has to run before any thread starts.
/// WebKit's processes are separate programs, so they get the same limit from
/// `MALLOC_ARENA_MAX`, which glibc reads at their start. Every other child
/// inherits it too, such as an app `xdg-open` starts. A limit the user set
/// already, through that variable or `GLIBC_TUNABLES`, is left alone in every
/// process, this one included.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn limit_malloc_arenas() {
    const ARENAS: i32 = 2;
    let tunables = std::env::var("GLIBC_TUNABLES").unwrap_or_default();
    if std::env::var_os("MALLOC_ARENA_MAX").is_some() || tunables.contains("arena_max") {
        return;
    }
    // SAFETY: called first thing in `main`, before any other thread exists, so
    // nothing allocates concurrently and nothing reads the environment.
    unsafe {
        libc::mallopt(libc::M_ARENA_MAX, ARENAS);
        std::env::set_var("MALLOC_ARENA_MAX", ARENAS.to_string());
    }
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
fn limit_malloc_arenas() {}
