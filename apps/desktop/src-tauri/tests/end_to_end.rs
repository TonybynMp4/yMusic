//! The join the other suites leave untested: a track discovered by scanning a
//! folder, resolved to a lease, and actually decoded by mpv.
//!
//! `library.rs` proves the scan, `playback.rs` proves mpv. This proves the
//! handoff between them -- specifically that the `file://` URL the library
//! builds is one mpv will open, which no amount of schema agreement
//! guarantees.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use ymusic_lib::{
    library::Library,
    playback::{EventSink, LoadRequest, PlaybackEvent, PlaybackStatus, Player},
};

#[derive(Clone, Default)]
struct Recorder {
    events: Arc<Mutex<Vec<PlaybackEvent>>>,
    ended: Arc<AtomicBool>,
}

impl EventSink for Recorder {
    fn send(&self, event: PlaybackEvent) {
        if matches!(event, PlaybackEvent::Ended { .. }) {
            self.ended.store(true, Ordering::SeqCst);
        }
        self.events.lock().expect("recorder mutex").push(event);
    }
}

#[test]
fn a_scanned_track_plays_through_its_lease() {
    // The fixture is a real 2s FLAC, so this decodes actual audio rather than
    // asserting against a stub.
    std::env::set_var("YMUSIC_AUDIO_OUTPUT", "null");

    let home = std::env::temp_dir().join(format!("ymusic-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(&home).expect("temp home");

    let fixtures =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/library/Nebula");
    let library =
        Library::open(&home.join("library.sqlite3"), home.join("art")).expect("open library");
    library.add_folder(&fixtures).expect("add folder");
    library.scan_all().expect("scan");

    let track = library
        .tracks()
        .expect("tracks")
        .into_iter()
        .find(|t| t.title == "First Light")
        .expect("the flac fixture");

    let lease = library.resolve(&track.id).expect("resolve");

    let player = Player::new().expect("libmpv");
    let recorder = Recorder::default();
    player.subscribe(recorder.clone());

    player
        .load(LoadRequest {
            track_id: lease.track_id.clone(),
            url: lease.url.clone(),
            headers: lease.headers.clone(),
            start_paused: false,
        })
        .unwrap_or_else(|error| panic!("mpv rejected the lease URL `{}`: {error}", lease.url));

    let deadline = Instant::now() + Duration::from_secs(20);
    while !recorder.ended.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline, "the track never reached the end");
        std::thread::sleep(Duration::from_millis(100));
    }

    let events = recorder.events.lock().expect("recorder mutex").clone();

    let errors: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            PlaybackEvent::Error { message, .. } => Some(message.clone()),
            _ => None,
        })
        .collect();
    assert!(errors.is_empty(), "playback reported errors: {errors:?}");

    assert!(
        events
            .iter()
            .any(|e| matches!(e, PlaybackEvent::Status { status: PlaybackStatus::Playing })),
        "mpv never reported playing"
    );

    // The library's duration came from the tags; mpv's came from decoding.
    // Agreement means the two halves are describing the same file.
    let decoded = events
        .iter()
        .filter_map(|e| match e {
            PlaybackEvent::Position { duration_ms: Some(ms), .. } => Some(*ms),
            _ => None,
        })
        .next_back()
        .expect("mpv reported a duration");
    let tagged = track.duration_ms.expect("the fixture is tagged with a duration") as u64;
    assert!(
        decoded.abs_diff(tagged) < 200,
        "tagged {tagged}ms but decoded {decoded}ms",
    );

    // Ended must name the same track the queue asked for, or auto-advance
    // would fire against the wrong id.
    let ended_id = events.iter().find_map(|e| match e {
        PlaybackEvent::Ended { track_id } => Some(track_id.clone()),
        _ => None,
    });
    assert_eq!(ended_id.flatten().as_deref(), Some(track.id.as_str()));

    let _ = std::fs::remove_dir_all(&home);
}
