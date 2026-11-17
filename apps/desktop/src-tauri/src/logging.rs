//! Where the log goes: a file per day in the app's log directory, and stderr.
//! See docs/logging.md.

use std::fmt::Write as _;
use std::fs::{self, File, OpenOptions};
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use chrono::{Local, NaiveDate};
use tracing::level_filters::LevelFilter;
use tracing::Subscriber;
use tracing_subscriber::field::RecordFields;
use tracing_subscriber::fmt::format::{DefaultFields, Writer};
use tracing_subscriber::fmt::time::ChronoLocal;
use tracing_subscriber::fmt::{FormatFields, MakeWriter};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter, Layer};

/// Crates held at `warn` unless `RUST_LOG` says otherwise.
const QUIET: &[&str] = &[
    // The MPRIS backend's async runtime traces every poll, which buries
    // everything else in the log within seconds.
    "zbus",
    "polling",
    "async_io",
    // One line per connection and frame, and a "shouldn't retry!" per
    // request: noise that reads like errors and is not.
    "reqwest",
    "hyper",
    "hyper_util",
    "h2",
    // A line for every cookie YouTube sets on the engine's client.
    "cookie_store",
];

/// Days of log files kept beside the current one.
const KEEP_DAYS: usize = 7;

/// The most one file holds. A day that outgrows it keeps its earlier lines in
/// a second file, so a day takes twice this at most.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// The most kept in memory for the file before `open` says where it is.
const MAX_WAITING: usize = 64 * 1024;

const PREFIX: &str = "yMusic.";
const SUFFIX: &str = ".log";

/// What is logged unless `RUST_LOG` says otherwise: `debug`, with the quiet
/// crates at `quiet`.
fn defaults(quiet: LevelFilter) -> String {
    let mut filter = String::from("debug");
    for target in QUIET {
        let _ = write!(filter, ",{target}={quiet}");
    }
    filter
}

/// The level `RUST_LOG` sets for everything: its last directive that is a
/// level and nothing else.
fn global_level(env: &str) -> Option<LevelFilter> {
    env.split(',')
        .map(str::trim)
        .filter(|directive| !directive.is_empty())
        .filter_map(|directive| directive.parse().ok())
        .next_back()
}

/// The filter: the defaults, then `RUST_LOG` on top, so a directive there for
/// the same target wins. A level for everything that is stricter than `warn`
/// (`error`, `off`) holds the quiet crates to it too, and a looser one leaves
/// them at `warn`. A `RUST_LOG` that does not parse is reported and left out.
fn filter(env: Option<&str>) -> (EnvFilter, Option<String>) {
    let fallback = || EnvFilter::new(defaults(LevelFilter::WARN));
    match env.map(str::trim).filter(|env| !env.is_empty()) {
        None => (fallback(), None),
        Some(env) => {
            let quiet = global_level(env).map_or(LevelFilter::WARN, |level| {
                std::cmp::min(level, LevelFilter::WARN)
            });
            match EnvFilter::try_new(format!("{},{env}", defaults(quiet))) {
                Ok(filter) => (filter, None),
                Err(error) => (
                    fallback(),
                    Some(format!("ignoring RUST_LOG={env:?}: {error}")),
                ),
            }
        }
    }
}

/// The file layer's own field formatter. fmt stores a span's formatted fields
/// under the formatter's type, so two layers with the same one share them:
/// each appends what `Span::record` sets, which prints it twice, and stderr
/// would reuse the file's colourless text.
#[derive(Default)]
struct FileFields(DefaultFields);

impl<'writer> FormatFields<'writer> for FileFields {
    fn format_fields<R: RecordFields>(
        &self,
        writer: Writer<'writer>,
        fields: R,
    ) -> std::fmt::Result {
        self.0.format_fields(writer, fields)
    }
}

fn timer() -> ChronoLocal {
    ChronoLocal::new("%Y-%m-%d %H:%M:%S%.3f".to_owned())
}

fn file_layer<S, W>(writer: W) -> impl Layer<S>
where
    S: Subscriber + for<'span> LookupSpan<'span>,
    W: for<'writer> MakeWriter<'writer> + 'static,
{
    fmt::layer()
        .fmt_fields(FileFields::default())
        .with_timer(timer())
        .with_ansi(false)
        .with_writer(writer)
}

fn stderr_layer<S, W>(writer: W, ansi: bool) -> impl Layer<S>
where
    S: Subscriber + for<'span> LookupSpan<'span>,
    W: for<'writer> MakeWriter<'writer> + 'static,
{
    fmt::layer()
        .with_timer(timer())
        .with_ansi(ansi)
        .with_writer(writer)
}

/// The log file. It is written in the calling thread rather than through a
/// worker: the log is a few lines a minute, and the release build aborts on
/// panic, which would drop whatever a worker had not written yet.
static FILE: LogFile = LogFile::new(today);

/// Installs the global subscriber, writing to stderr and to the log file, and
/// bridges the `log` records of the crates that still use it. Call it once,
/// before anything can log. The file's lines wait in memory until `open`.
pub fn init() {
    let (filter, filter_error) = filter(std::env::var("RUST_LOG").ok().as_deref());
    let installed = tracing_subscriber::registry()
        .with(filter)
        .with(file_layer(|| &FILE))
        .with(stderr_layer(
            std::io::stderr,
            std::io::stderr().is_terminal(),
        ))
        .try_init();
    if let Err(error) = installed {
        eprintln!("logging was already set up: {error}");
        return;
    }
    if let Some(error) = filter_error {
        tracing::warn!("{error}");
    }
}

/// Starts the log file in `dir` with the lines logged since `init`. Without a
/// directory, or one that can't be written, the log goes to stderr only.
pub fn open(dir: Option<&Path>) {
    let Some(dir) = dir else {
        FILE.close();
        tracing::error!("no app log directory, logging to stderr only");
        return;
    };
    if let Err(error) = FILE.open(dir) {
        tracing::error!(dir = %dir.display(), "logging to stderr only: {error}");
    }
}

/// The local date, which is the one the lines are stamped with.
fn today() -> NaiveDate {
    Local::now().date_naive()
}

struct LogFile {
    state: Mutex<Sink>,
    /// Which day a line belongs to. Tests set the day themselves.
    today: fn() -> NaiveDate,
}

enum Sink {
    /// Before `open`: the lines so far, up to `MAX_WAITING`.
    Waiting(Vec<u8>),
    Open(DayFile),
    /// There is nowhere to write.
    Closed,
}

impl LogFile {
    const fn new(today: fn() -> NaiveDate) -> Self {
        Self {
            state: Mutex::new(Sink::Waiting(Vec::new())),
            today,
        }
    }

    /// A panic while logging leaves nothing half done that matters, so a
    /// poisoned lock is used as it is.
    fn sink(&self) -> MutexGuard<'_, Sink> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn open(&self, dir: &Path) -> io::Result<()> {
        let today = (self.today)();
        let mut sink = self.sink();
        let waiting = match std::mem::replace(&mut *sink, Sink::Closed) {
            Sink::Waiting(lines) => lines,
            _ => Vec::new(),
        };
        let mut file = DayFile::open(dir, today)?;
        file.write(today, &waiting)?;
        *sink = Sink::Open(file);
        Ok(())
    }

    fn close(&self) {
        *self.sink() = Sink::Closed;
    }

    fn write(&self, line: &[u8]) -> io::Result<()> {
        match &mut *self.sink() {
            Sink::Waiting(lines) => {
                if lines.len() + line.len() <= MAX_WAITING {
                    lines.extend_from_slice(line);
                }
                Ok(())
            }
            Sink::Open(file) => file.write((self.today)(), line),
            Sink::Closed => Ok(()),
        }
    }
}

/// fmt hands over each line whole, in one call.
impl Write for &LogFile {
    fn write(&mut self, line: &[u8]) -> io::Result<usize> {
        LogFile::write(self, line)?;
        Ok(line.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// One local day's file, `yMusic.<date>.log`. tracing-appender's daily
/// rotation goes by the UTC date and has no size cap, which is why this is
/// not it.
struct DayFile {
    dir: PathBuf,
    day: NaiveDate,
    file: File,
    len: u64,
}

impl DayFile {
    /// Opens the file for `day`, appending to what an earlier run wrote, and
    /// deletes the files of days past the ones kept.
    fn open(dir: &Path, day: NaiveDate) -> io::Result<Self> {
        fs::create_dir_all(dir)?;
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(current(dir, day))?;
        let len = file.metadata()?.len();
        prune(dir);
        Ok(Self {
            dir: dir.to_owned(),
            day,
            file,
            len,
        })
    }

    fn write(&mut self, today: NaiveDate, line: &[u8]) -> io::Result<()> {
        if today != self.day {
            *self = Self::open(&self.dir, today)?;
        } else if self.len > 0 && self.len + line.len() as u64 > MAX_BYTES {
            self.start_over()?;
        }
        self.file.write_all(line)?;
        self.len += line.len() as u64;
        Ok(())
    }

    /// The full file becomes the day's earlier one, replacing the last, and
    /// the day goes on in an empty file.
    fn start_over(&mut self) -> io::Result<()> {
        let path = current(&self.dir, self.day);
        // If the rename fails the file is still there, and truncating it
        // below keeps the cap all the same.
        let _ = fs::rename(&path, earlier(&self.dir, self.day));
        self.file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)?;
        self.len = 0;
        Ok(())
    }
}

fn current(dir: &Path, day: NaiveDate) -> PathBuf {
    dir.join(format!("{PREFIX}{day}{SUFFIX}"))
}

/// The lines of `day` from before its file last filled up.
fn earlier(dir: &Path, day: NaiveDate) -> PathBuf {
    dir.join(format!("{PREFIX}{day}.1{SUFFIX}"))
}

/// The day a log file is for, or None for a file that is not one of ours.
fn day_of(name: &str) -> Option<NaiveDate> {
    let day = name.strip_prefix(PREFIX)?.strip_suffix(SUFFIX)?;
    day.strip_suffix(".1").unwrap_or(day).parse().ok()
}

/// Deletes the files of every day older than the newest `KEEP_DAYS + 1`.
fn prune(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let files: Vec<(NaiveDate, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| Some((day_of(entry.file_name().to_str()?)?, entry.path())))
        .collect();
    let mut days: Vec<NaiveDate> = files.iter().map(|(day, _)| *day).collect();
    days.sort_unstable_by(|a, b| b.cmp(a));
    days.dedup();
    let Some(&oldest_kept) = days.get(KEEP_DAYS) else {
        return;
    };
    for (day, path) in files {
        if day < oldest_kept {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ymusic-logging-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn day(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, day).expect("a real date")
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .expect("the log directory")
            .map(|entry| {
                entry
                    .expect("an entry")
                    .file_name()
                    .into_string()
                    .expect("utf-8")
            })
            .collect();
        names.sort();
        names
    }

    #[test]
    fn the_defaults_parse() {
        assert!(EnvFilter::try_new(defaults(LevelFilter::WARN)).is_ok());
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
        assert!(shown.contains("hyper=warn"), "{shown}");
    }

    #[test]
    fn a_stricter_level_for_everything_reaches_the_quiet_crates() {
        for level in ["error", "off"] {
            let (filter, error) = filter(Some(level));
            assert!(error.is_none());
            let shown = filter.to_string();
            assert!(!shown.contains("warn"), "{shown}");
            assert!(!shown.contains("debug"), "{shown}");
            assert!(shown.contains(&format!("zbus={level}")), "{shown}");
        }
    }

    #[test]
    fn a_looser_level_for_everything_leaves_the_quiet_crates_at_warn() {
        let (filter, error) = filter(Some("ymusic_lib=debug, trace"));
        assert!(error.is_none());
        let shown = filter.to_string();
        assert!(shown.contains("zbus=warn"), "{shown}");
        assert!(shown.contains("trace"), "{shown}");
    }

    #[test]
    fn a_bad_rust_log_falls_back_to_the_defaults() {
        let (filter, error) = filter(Some("ymusic_lib=loud"));
        assert!(error.is_some());
        assert_eq!(
            filter.to_string(),
            EnvFilter::new(defaults(LevelFilter::WARN)).to_string()
        );
    }

    #[derive(Clone, Default)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);

    impl Buffer {
        fn text(&self) -> String {
            String::from_utf8(self.0.lock().expect("buffer").clone()).expect("utf-8")
        }
    }

    impl Write for Buffer {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.lock().expect("buffer").extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_recorded_field_prints_once_in_each_output() {
        let (file, stderr) = (Buffer::default(), Buffer::default());
        let subscriber = tracing_subscriber::registry()
            .with(file_layer({
                let file = file.clone();
                move || file.clone()
            }))
            .with(stderr_layer(
                {
                    let stderr = stderr.clone();
                    move || stderr.clone()
                },
                true,
            ));
        tracing::subscriber::with_default(subscriber, || {
            let span = tracing::info_span!("import", browser = tracing::field::Empty);
            let _entered = span.enter();
            span.record("browser", "firefox");
            tracing::info!("reading");
        });
        let (file, stderr) = (file.text(), stderr.text());
        assert_eq!(file.matches("firefox").count(), 1, "{file}");
        assert_eq!(stderr.matches("firefox").count(), 1, "{stderr}");
        assert!(!file.contains('\u{1b}'), "{file}");
        assert!(stderr.contains('\u{1b}'), "{stderr}");
    }

    #[test]
    fn lines_before_open_reach_the_file() {
        let dir = temp_dir("waiting");
        let log = LogFile::new(|| day(15));
        log.write(b"early\n").expect("held in memory");
        log.open(&dir).expect("the file opens");
        log.write(b"late\n").expect("written");
        let text = fs::read_to_string(current(&dir, day(15))).expect("the file");
        assert_eq!(text, "early\nlate\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_local_day_starts_a_new_file() {
        let dir = temp_dir("day");
        let mut file = DayFile::open(&dir, day(14)).expect("the file opens");
        file.write(day(14), b"evening\n").expect("written");
        file.write(day(15), b"morning\n").expect("written");
        assert_eq!(
            names(&dir),
            ["yMusic.2026-11-14.log", "yMusic.2026-11-15.log"]
        );
        let text = fs::read_to_string(current(&dir, day(15))).expect("the file");
        assert_eq!(text, "morning\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_full_file_keeps_one_earlier_part() {
        let dir = temp_dir("cap");
        let mut file = DayFile::open(&dir, day(15)).expect("the file opens");
        let line = vec![b'a'; MAX_BYTES as usize / 2 + 1];
        for _ in 0..5 {
            file.write(day(15), &line).expect("written");
        }
        assert_eq!(
            names(&dir),
            ["yMusic.2026-11-15.1.log", "yMusic.2026-11-15.log"]
        );
        for path in [current(&dir, day(15)), earlier(&dir, day(15))] {
            let len = fs::metadata(path).expect("the file").len();
            assert!(len <= MAX_BYTES, "{len}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn old_days_are_deleted_with_their_earlier_parts() {
        let dir = temp_dir("prune");
        fs::create_dir_all(&dir).expect("the directory");
        for old in 1..=10 {
            fs::write(current(&dir, day(old)), "").expect("a file");
        }
        fs::write(earlier(&dir, day(2)), "").expect("a file");
        fs::write(earlier(&dir, day(9)), "").expect("a file");
        fs::write(dir.join("notes.txt"), "").expect("a file");
        DayFile::open(&dir, day(11)).expect("the file opens");
        // The 11th and the seven days before it, with their earlier parts.
        assert_eq!(
            names(&dir),
            [
                "notes.txt",
                "yMusic.2026-11-04.log",
                "yMusic.2026-11-05.log",
                "yMusic.2026-11-06.log",
                "yMusic.2026-11-07.log",
                "yMusic.2026-11-08.log",
                "yMusic.2026-11-09.1.log",
                "yMusic.2026-11-09.log",
                "yMusic.2026-11-10.log",
                "yMusic.2026-11-11.log",
            ]
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
