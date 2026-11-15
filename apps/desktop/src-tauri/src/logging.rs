//! Where the log goes: a file per day in the app's log directory, and stderr.
//! See docs/logging.md.

use std::io::IsTerminal;
use std::path::Path;

use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::fmt::time::ChronoLocal;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter};

/// What is logged unless `RUST_LOG` says otherwise. `RUST_LOG` is read after
/// these, so a directive there for the same target wins.
pub const DEFAULT_FILTER: &str = concat!(
    "debug",
    // The MPRIS backend's async runtime traces every poll, which buries
    // everything else in the log within seconds.
    ",zbus=warn,polling=warn,async_io=warn",
    // One line per connection and frame, and a "shouldn't retry!" per
    // request: noise that reads like errors and is not.
    ",reqwest=warn,hyper=warn,hyper_util=warn,h2=warn",
    // A line for every cookie YouTube sets on the engine's client.
    ",cookie_store=warn",
);

/// Days of log files kept beside the current one.
const KEEP_FILES: usize = 7;

/// The filter: the defaults, then `RUST_LOG` on top. A `RUST_LOG` that does
/// not parse is reported and left out.
fn filter(env: Option<&str>) -> (EnvFilter, Option<String>) {
    let defaults = || EnvFilter::new(DEFAULT_FILTER);
    match env.map(str::trim).filter(|env| !env.is_empty()) {
        None => (defaults(), None),
        Some(env) => match EnvFilter::try_new(format!("{DEFAULT_FILTER},{env}")) {
            Ok(filter) => (filter, None),
            Err(error) => (
                defaults(),
                Some(format!("ignoring RUST_LOG={env:?}: {error}")),
            ),
        },
    }
}

/// Installs the global subscriber, writing to `dir` (when there is one) and to
/// stderr, and bridges the `log` records of the crates that still use it. Call
/// it once, as early as the log directory is known.
pub fn init(dir: Option<&Path>) {
    let (filter, filter_error) = filter(std::env::var("RUST_LOG").ok().as_deref());
    let timer = || ChronoLocal::new("%Y-%m-%d %H:%M:%S%.3f".to_owned());

    // Written in the calling thread rather than through tracing-appender's
    // worker: the log is a few lines a minute, and the release build aborts on
    // panic, which would drop whatever a worker had not written yet.
    let (file, file_error) = match dir.map(open_file) {
        Some(Ok(appender)) => (Some(appender), None),
        Some(Err(error)) => (None, Some(error)),
        None => (None, None),
    };
    let file = file.map(|appender| {
        fmt::layer()
            .with_timer(timer())
            .with_ansi(false)
            .with_writer(appender)
    });
    let stderr = fmt::layer()
        .with_timer(timer())
        .with_ansi(std::io::stderr().is_terminal())
        .with_writer(std::io::stderr);

    let installed = tracing_subscriber::registry()
        .with(filter)
        .with(file)
        .with(stderr)
        .try_init();
    if let Err(error) = installed {
        eprintln!("logging was already set up: {error}");
        return;
    }
    if let Some(error) = filter_error {
        tracing::warn!("{error}");
    }
    match (dir, file_error) {
        (Some(dir), Some(error)) => {
            tracing::error!(dir = %dir.display(), "logging to stderr only: {error}")
        }
        (None, _) => tracing::error!("no app log directory, logging to stderr only"),
        _ => {}
    }
}

fn open_file(dir: &Path) -> Result<RollingFileAppender, String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("yMusic")
        .filename_suffix("log")
        .max_log_files(KEEP_FILES + 1)
        .build(dir)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_defaults_parse() {
        assert!(EnvFilter::try_new(DEFAULT_FILTER).is_ok());
        assert!(filter(None).1.is_none());
        assert!(filter(Some("  ")).1.is_none());
    }

    #[test]
    fn rust_log_goes_on_top_of_the_defaults() {
        let (filter, error) = filter(Some("ymusic_lib=trace,zbus=debug"));
        assert!(error.is_none());
        let shown = filter.to_string();
        assert!(shown.contains("ymusic_lib=trace"), "{shown}");
        assert!(shown.contains("zbus=debug"), "{shown}");
        assert!(!shown.contains("zbus=warn"), "{shown}");
    }

    #[test]
    fn a_bad_rust_log_falls_back_to_the_defaults() {
        let (filter, error) = filter(Some("ymusic_lib=loud"));
        assert!(error.is_some());
        assert_eq!(
            filter.to_string(),
            EnvFilter::new(DEFAULT_FILTER).to_string()
        );
    }
}
