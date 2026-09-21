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
    }
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

#[test]
fn pause_and_seek_are_reflected_in_the_event_stream() {
    let (player, recorder) = player();
    player.load(request(fixture_url("tone.wav"))).expect("load");
    assert!(
        recorder.wait_for(Duration::from_secs(10), |r| r
            .saw_status(PlaybackStatus::Playing)),
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
        recorder.wait_for(Duration::from_secs(10), |r| r
            .saw_status(PlaybackStatus::Playing)),
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
