// Keeps the console window from flashing up alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    limit_malloc_arenas();
    #[cfg(debug_assertions)]
    if let [_, flag, path] = std::env::args().collect::<Vec<_>>().as_slice() {
        if flag == "--export-account-key" {
            if let Err(error) = ymusic_lib::account::export_key(path.as_ref()) {
                eprintln!("{error}");
                std::process::exit(1);
            }
            return;
        }
    }
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
    if user_set_arena_limit(std::env::var_os("MALLOC_ARENA_MAX").is_some(), &tunables) {
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

/// Whether the user limited the arenas already, through `MALLOC_ARENA_MAX`
/// or a `glibc.malloc.arena_max` entry in `GLIBC_TUNABLES`.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn user_set_arena_limit(arena_max_set: bool, tunables: &str) -> bool {
    arena_max_set
        || tunables
            .split(':')
            .any(|tunable| tunable.starts_with("glibc.malloc.arena_max="))
}

#[cfg(all(test, target_os = "linux", target_env = "gnu"))]
mod tests {
    use super::user_set_arena_limit;

    #[test]
    fn limits_arenas_when_the_user_did_not() {
        assert!(!user_set_arena_limit(false, ""));
        assert!(!user_set_arena_limit(false, "glibc.malloc.tcache_count=0"));
        assert!(!user_set_arena_limit(false, "glibc.malloc.arena_test=4"));
    }

    #[test]
    fn leaves_a_limit_the_user_set_alone() {
        assert!(user_set_arena_limit(true, ""));
        assert!(user_set_arena_limit(false, "glibc.malloc.arena_max=8"));
        assert!(user_set_arena_limit(
            false,
            "glibc.malloc.tcache_count=0:glibc.malloc.arena_max=4"
        ));
    }
}
