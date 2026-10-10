//! Exercises the mpv layer for real: it decodes actual audio, over the local
//! filesystem and over HTTPS, and asserts the event stream the queue is
//! written against. `ao=null` keeps it runnable without a sound card.

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use ymusic_lib::playback::{EventSink, LoadRequest, PlaybackEvent, PlaybackStatus, Player};

#[derive(Clone, Default)]
struct Recorder(Arc<Mutex<Vec<PlaybackEvent>>>);

impl EventSink for Recorder {
    fn send(&self, event: PlaybackEvent) {
        self.0.lock().expect("recorder mutex").push(event);
    }
}

impl Recorder {
    fn events(&self) -> Vec<PlaybackEvent> {
        self.0.lock().expect("recorder mutex").clone()
    }

    fn saw_status(&self, wanted: PlaybackStatus) -> bool {
        self.events()
            .iter()
            .any(|event| matches!(event, PlaybackEvent::Status { status } if *status == wanted))
    }

    /// mpv reports its initial `pause` of false as soon as it is observed,
    /// before any file is open, so "playing" alone doesn't mean a seek can land
    /// yet. A position only arrives once the file is loaded.
    fn saw_playback(&self) -> bool {
        self.saw_status(PlaybackStatus::Playing)
            && self
                .events()
                .iter()
                .any(|event| matches!(event, PlaybackEvent::Position { .. }))
    }

    fn max_position_ms(&self) -> u64 {
        self.events()
            .iter()
            .filter_map(|event| match event {
                PlaybackEvent::Position { position_ms, .. } => Some(*position_ms),
                _ => None,
            })
            .max()
            .unwrap_or(0)
    }

    fn errors(&self) -> Vec<String> {
        self.events()
            .iter()
            .filter_map(|event| match event {
                PlaybackEvent::Error { message, .. } => Some(message.clone()),
                _ => None,
            })
            .collect()
    }

    fn wait_for(&self, deadline: Duration, condition: impl Fn(&Recorder) -> bool) -> bool {
        let start = Instant::now();
        while start.elapsed() < deadline {
            if condition(self) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }
}

fn player() -> (Player, Recorder) {
    std::env::set_var("YMUSIC_AUDIO_OUTPUT", "null");
    let player = Player::new().expect("libmpv should be available");
    let recorder = Recorder::default();
    player.subscribe(recorder.clone());
    (player, recorder)
}

fn fixture_url(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    path.to_string_lossy().into_owned()
}

fn request(url: String) -> LoadRequest {
    LoadRequest {
        track_id: "test-track".into(),
        url,
        headers: Default::default(),
        start_paused: false,
        loudness_db: None,
        start_ms: None,
    }
}

fn track(id: &str, url: String) -> LoadRequest {
    LoadRequest {
        track_id: id.into(),
        ..request(url)
    }
}

/// The fixture under another name, so mpv's `path` tells the two apart.
fn second_fixture() -> String {
    let dir = std::env::temp_dir().join(format!("ymusic-gapless-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let copy = dir.join("second.wav");
    std::fs::copy(fixture_url("tone.wav"), &copy).expect("copy the fixture");
    copy.to_string_lossy().into_owned()
}

impl Recorder {
    fn ended(&self) -> Vec<Option<String>> {
        self.events()
            .into_iter()
            .filter_map(|event| match event {
                PlaybackEvent::Ended { track_id } => Some(track_id),
                _ => None,
            })
            .collect()
    }

    fn advanced(&self) -> Vec<String> {
        self.events()
            .into_iter()
            .filter_map(|event| match event {
                PlaybackEvent::Advanced { track_id } => Some(track_id),
                _ => None,
            })
            .collect()
    }
}

#[test]
fn an_appended_track_follows_without_ending_the_queue() {
    let (player, recorder) = player();
    player
        .load(track("first", fixture_url("tone.wav")))
        .expect("load");
    assert!(
        recorder.wait_for(Duration::from_secs(10), |r| r.saw_playback()),
        "never started playing"
    );
    player
        .queue_next("first", Some(track("second", second_fixture())))
        .expect("queue the next track");

    assert!(
        recorder.wait_for(Duration::from_secs(10), |r| !r.ended().is_empty()),
        "never reached the end; events: {:?}",
        recorder.events()
    );
    assert_eq!(recorder.advanced(), ["second"]);
    // Only the second song ends: the first went straight on into it.
    assert_eq!(recorder.ended(), [Some("second".to_string())]);
    let loading = recorder
        .events()
        .iter()
        .filter(|e| {
            matches!(
                e,
                PlaybackEvent::Status {
                    status: PlaybackStatus::Loading
                }
            )
        })
        .count();
    assert_eq!(loading, 1, "the join showed a loading status");
    assert!(recorder.errors().is_empty(), "{:?}", recorder.errors());
}

#[test]
fn a_next_track_taken_back_or_meant_for_another_song_is_not_played() {
    let (player, recorder) = player();
    player
        .load(track("first", fixture_url("tone.wav")))
        .expect("load");
    assert!(
        recorder.wait_for(Duration::from_secs(10), |r| r.saw_playback()),
        "never started playing"
    );
    player
        .queue_next("first", Some(track("second", second_fixture())))
        .expect("queue the next track");
    player.queue_next("first", None).expect("take it back");
    // Asked about a song that is no longer playing, so it is dropped.
    player
        .queue_next("earlier", Some(track("third", second_fixture())))
        .expect("queue for another song");

    assert!(
        recorder.wait_for(Duration::from_secs(10), |r| !r.ended().is_empty()),
        "never reached the end; events: {:?}",
        recorder.events()
    );
    assert_eq!(recorder.ended(), [Some("first".to_string())]);
    assert!(recorder.advanced().is_empty());
}

/// Loading a song replaces the appended one: the queue moved on by hand.
#[test]
fn loading_a_song_drops_the_appended_one() {
    let (player, recorder) = player();
    player
        .load(track("first", fixture_url("tone.wav")))
        .expect("load");
    assert!(
        recorder.wait_for(Duration::from_secs(10), |r| r.saw_playback()),
        "never started playing"
    );
    player
        .queue_next("first", Some(track("second", second_fixture())))
        .expect("queue the next track");
    player
        .load(track("picked", fixture_url("tone.wav")))
        .expect("load another");

    assert!(
        recorder.wait_for(Duration::from_secs(10), |r| !r.ended().is_empty()),
        "never reached the end; events: {:?}",
        recorder.events()
    );
    assert_eq!(recorder.ended(), [Some("picked".to_string())]);
    assert!(recorder.advanced().is_empty());
}

#[test]
fn plays_a_local_file_through_to_the_end() {
    let (player, recorder) = player();
    player.load(request(fixture_url("tone.wav"))).expect("load");

    assert!(
        recorder.wait_for(Duration::from_secs(10), |r| {
            r.events()
                .iter()
                .any(|event| matches!(event, PlaybackEvent::Ended { .. }))
        }),
        "never reached the end of a 2s file; events: {:?}",
        recorder.events()
    );

    assert!(
        recorder.errors().is_empty(),
        "unexpected errors: {:?}",
        recorder.errors()
    );
    assert!(
        recorder.saw_status(PlaybackStatus::Playing),
        "never reported playing"
    );
    assert!(
        recorder.max_position_ms() > 500,
        "position never advanced past 500ms, got {}",
        recorder.max_position_ms()
    );

    // The duration mpv reports should match the fixture, within a frame or two.
    let duration = recorder
        .events()
        .iter()
        .find_map(|event| match event {
            PlaybackEvent::Position {
                duration_ms: Some(ms),
                ..
            } => Some(*ms),
            _ => None,
        })
        .expect("a duration should have been reported");
    assert!(
        (1900..=2100).contains(&duration),
        "unexpected duration {duration}ms"
    );
}

// libmpv2 reports a file that fails to load as an event error rather than an
// `EndFile`, and a refused YouTube stream only reaches the queue's fallback
// retry through this event.
#[test]
fn a_file_that_fails_to_load_reports_an_error_for_its_track() {
    let (player, recorder) = player();
    player
        .load(request(fixture_url("does-not-exist.wav")))
        .expect("load");

    assert!(
        recorder.wait_for(Duration::from_secs(10), |r| !r.errors().is_empty()),
        "a missing file never reported an error; events: {:?}",
        recorder.events()
    );
    let track = recorder.events().into_iter().find_map(|event| match event {
        PlaybackEvent::Error { track_id, .. } => Some(track_id),
        _ => None,
    });
    assert_eq!(track, Some(Some("test-track".into())));
}

#[test]
fn pause_and_seek_are_reflected_in_the_event_stream() {
    let (player, recorder) = player();
    player.load(request(fixture_url("tone.wav"))).expect("load");
    assert!(
        recorder.wait_for(Duration::from_secs(10), |r| r.saw_playback()),
        "never started playing"
    );

    player.pause().expect("pause");
    assert!(
        recorder.wait_for(Duration::from_secs(5), |r| r
            .saw_status(PlaybackStatus::Paused)),
        "pause was never reported; events: {:?}",
        recorder.events()
    );

    player.seek(1_500).expect("seek");
    player.play().expect("play");
    assert!(
        recorder.wait_for(Duration::from_secs(5), |r| r.max_position_ms() >= 1_400),
        "seek to 1.5s never showed up in positions, max was {}",
        recorder.max_position_ms()
    );
}

/// mpv restarts playback after every seek, paused or not. Reading that as
/// "playing" would flip the play button while the user scrubs a paused track.
#[test]
fn seeking_while_paused_stays_paused() {
    let (player, recorder) = player();
    player.load(request(fixture_url("tone.wav"))).expect("load");
    assert!(
        recorder.wait_for(Duration::from_secs(10), |r| r.saw_playback()),
        "never started playing"
    );
    player.pause().expect("pause");
    assert!(
        recorder.wait_for(Duration::from_secs(5), |r| r
            .saw_status(PlaybackStatus::Paused)),
        "pause was never reported"
    );

    let before = recorder.events().len();
    player.seek(1_500).expect("seek");
    assert!(
        recorder.wait_for(Duration::from_secs(5), |r| r.max_position_ms() >= 1_400),
        "the seek never landed"
    );
    // Give a stray restart event time to arrive before judging its absence.
    std::thread::sleep(Duration::from_millis(300));
    let after_seek = &recorder.events()[before..];
    assert!(
        !after_seek.iter().any(|e| matches!(
            e,
            PlaybackEvent::Status {
                status: PlaybackStatus::Playing
            }
        )),
        "a paused seek reported playing: {after_seek:?}"
    );
}

/// A queue restored at launch loads its song paused where it was left, and
/// the player reads that position back for the next exit.
#[test]
fn a_restored_song_starts_paused_where_it_was_left() {
    let (player, recorder) = player();
    player
        .load(LoadRequest {
            start_paused: true,
            start_ms: Some(1_500),
            ..track("restored", fixture_url("tone.wav"))
        })
        .expect("load");
    assert!(
        recorder.wait_for(Duration::from_secs(10), |r| r.max_position_ms() >= 1_400),
        "never opened at the saved position"
    );
    // Long enough that a song left playing would have moved on.
    std::thread::sleep(Duration::from_millis(600));
    let last_status = recorder.events().into_iter().rev().find_map(|e| match e {
        PlaybackEvent::Status { status } => Some(status),
        _ => None,
    });
    assert_eq!(last_status, Some(PlaybackStatus::Paused));
    let (track, position_ms) = player.position().expect("a position");
    assert_eq!(track, "restored");
    assert!(
        (1_400..1_900).contains(&position_ms),
        "read back {position_ms} ms"
    );
}

/// The point of the whole design: mpv streams an HTTPS audio URL itself, over
/// range requests, with the headers we hand it. Requires network access.
#[test]
#[ignore = "requires network access"]
fn streams_https_audio_with_custom_headers() {
    let (player, recorder) = player();
    let mut load = request("https://download.samplelib.com/mp3/sample-3s.mp3".into());
    load.headers.insert(
        "User-Agent".into(),
        "YMUSIC/0.1 (playback smoke test)".into(),
    );
    player.load(load).expect("load");

    assert!(
        recorder.wait_for(Duration::from_secs(30), |r| r.max_position_ms() > 500),
        "never got 500ms into the stream; events: {:?}",
        recorder.events()
    );
    assert!(
        recorder.errors().is_empty(),
        "unexpected errors: {:?}",
        recorder.errors()
    );
}
