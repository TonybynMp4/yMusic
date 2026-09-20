//! Audio playback through libmpv.
//!
//! mpv streams the audio-only URL itself over HTTP range requests, so there is
//! no local proxy in the path. Two things it needs from us: the headers that
//! resolved the URL (googlevideo binds the stream to that session, so a
//! mismatch is a 403 that looks like a bug elsewhere), and a URL that has not
//! expired yet. The second is the queue's job; the first is handled here.

mod event;

pub use event::{PlaybackEvent, PlaybackStatus};


use event::seconds_to_ms;
use libmpv2::{events::Event, Format, Mpv};
use serde::Deserialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    thread,
};

/// Where playback events go. In the app this is a Tauri `Channel`; in tests it
/// is a plain vector. Keeping the player behind this trait is what lets the
/// mpv layer be exercised without an app handle or a webview.
pub trait EventSink: Send + Sync + 'static {
    fn send(&self, event: PlaybackEvent);
}

impl EventSink for tauri::ipc::Channel<PlaybackEvent> {
    fn send(&self, event: PlaybackEvent) {
        if let Err(error) = tauri::ipc::Channel::send(self, event) {
            log::warn!("dropping playback event, channel closed: {error}");
        }
    }
}

type Sink = Arc<Mutex<Option<Box<dyn EventSink>>>>;

/// Property observer ids. Only used to tell `PropertyChange` events apart.
const OBSERVE_TIME_POS: u64 = 1;
const OBSERVE_DURATION: u64 = 2;
const OBSERVE_PAUSE: u64 = 3;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadRequest {
    /// The track this stream belongs to, echoed back on `ended` and `error` so
    /// the queue knows which track the event is about.
    pub track_id: String,
    pub url: String,
    /// Replayed verbatim onto mpv's request. Includes the user agent, cookies,
    /// and any PO token that the resolving fetch used.
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub start_paused: bool,
}

pub struct Player {
    mpv: Arc<Mpv>,
    /// The frontend's event sink, set by `player_subscribe`. None until the UI
    /// has asked for events, which is why the event thread tolerates its
    /// absence rather than treating it as an error.
    sink: Sink,
    current_track: Arc<Mutex<Option<String>>>,
}

/// libmpv refuses to initialize under a locale where `LC_NUMERIC` is not "C",
/// because its option parser would then read "0,5" for a decimal. GTK sets the
/// locale from the environment during Tauri's startup, so this has to run
/// before the first `mpv_create` — not once at program start, which is too
/// early to survive it.
#[cfg(unix)]
fn force_c_numeric_locale() {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // SAFETY: setlocale with a static category and string, called once
        // before any mpv handle exists.
        unsafe {
            libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr());
        }
    });
}

#[cfg(not(unix))]
fn force_c_numeric_locale() {}

impl Player {
    pub fn new() -> Result<Self, String> {
        force_c_numeric_locale();

        let mpv = Mpv::with_initializer(|init| {
            // Audio only: no window, no video decoding, and no cover art
            // masquerading as a video track.
            init.set_property("vid", "no")?;
            init.set_property("audio-display", "no")?;
            init.set_property("terminal", "no")?;
            // mpv must never shell out to yt-dlp. Stream resolution is the data
            // engine's job, and mpv reaching for the network on its own would
            // bypass the session binding entirely.
            init.set_property("ytdl", "no")?;
            // Stay alive with an empty playlist so the handle outlives a track.
            init.set_property("idle", "yes")?;
            init.set_property("keep-open", "no")?;
            init.set_property("gapless-audio", "yes")?;
            init.set_property("prefetch-playlist", "yes")?;
            init.set_property("cache", "yes")?;
            init.set_property("audio-client-name", "YTBM")?;
            // Tests and headless machines have no audio device; `ao=null`
            // decodes everything and discards the samples, which still
            // exercises the whole path up to the sound card.
            if let Ok(ao) = std::env::var("YTBM_AUDIO_OUTPUT") {
                init.set_property("ao", ao.as_str())?;
            }
            Ok(())
        })
        .map_err(|error| {
            format!("could not start libmpv (is libmpv2 installed?): {error}")
        })?;

        let mpv = Arc::new(mpv);
        let sink: Sink = Arc::new(Mutex::new(None));
        let current_track = Arc::new(Mutex::new(None));

        mpv.observe_property("time-pos", Format::Double, OBSERVE_TIME_POS)
            .map_err(|error| format!("could not observe time-pos: {error}"))?;
        mpv.observe_property("duration", Format::Double, OBSERVE_DURATION)
            .map_err(|error| format!("could not observe duration: {error}"))?;
        mpv.observe_property("pause", Format::Flag, OBSERVE_PAUSE)
            .map_err(|error| format!("could not observe pause: {error}"))?;

        spawn_event_thread(Arc::clone(&mpv), Arc::clone(&sink), Arc::clone(&current_track));

        Ok(Self {
            mpv,
            sink,
            current_track,
        })
    }

    pub fn subscribe(&self, sink: impl EventSink) {
        *self.sink.lock().expect("sink mutex") = Some(Box::new(sink));
    }

    pub fn load(&self, request: LoadRequest) -> Result<(), String> {
        *self.current_track.lock().expect("track mutex") = Some(request.track_id.clone());

        // Headers go on one at a time through change-list rather than as a
        // single comma-joined string: a Cookie or PO token containing a comma
        // would otherwise be split into two broken headers.
        self.command("change-list", &["http-header-fields", "clr", ""])?;
        for (name, value) in &request.headers {
            self.command(
                "change-list",
                &["http-header-fields", "append", &format!("{name}: {value}")],
            )?;
        }

        self.set_property("pause", request.start_paused)?;
        self.command("loadfile", &[&request.url, "replace"])
    }

    pub fn play(&self) -> Result<(), String> {
        self.set_property("pause", false)
    }

    pub fn pause(&self) -> Result<(), String> {
        self.set_property("pause", true)
    }

    pub fn seek(&self, position_ms: u64) -> Result<(), String> {
        let seconds = position_ms as f64 / 1000.0;
        self.command("seek", &[&seconds.to_string(), "absolute"])
    }

    /// Volume as a slider *position* in 0.0..=1.0, not an amplitude.
    ///
    /// mpv's `volume` property applies a cubic taper, so passing the position
    /// through unchanged is what makes the slider perceptually even: half way
    /// up is 0.125 amplitude, roughly half as loud. `tests/volume.rs` measures
    /// mpv's rendered output and fails if that curve ever changes, because the
    /// alternative is the app quietly getting a linear slider back.
    pub fn set_volume(&self, position: f64) -> Result<(), String> {
        self.set_property("volume", (position.clamp(0.0, 1.0) * 100.0).round())
    }

    pub fn stop(&self) -> Result<(), String> {
        *self.current_track.lock().expect("track mutex") = None;
        self.command("stop", &[])?;
        emit(&self.sink, PlaybackEvent::Status { status: PlaybackStatus::Idle });
        Ok(())
    }

    fn command(&self, name: &str, args: &[&str]) -> Result<(), String> {
        self.mpv
            .command(name, args)
            .map_err(|error| format!("mpv command `{name}` failed: {error}"))
    }

    fn set_property<T: libmpv2::SetData>(&self, name: &str, value: T) -> Result<(), String> {
        self.mpv
            .set_property(name, value)
            .map_err(|error| format!("mpv property `{name}` failed: {error}"))
    }
}

fn spawn_event_thread(mpv: Arc<Mpv>, sink: Sink, current_track: Arc<Mutex<Option<String>>>) {
    thread::Builder::new()
        .name("mpv-events".into())
        .spawn(move || {
            let mut duration_ms: Option<u64> = None;

            loop {
                let Some(event) = mpv.wait_event(0.5) else {
                    continue;
                };
                let event = match event {
                    Ok(event) => event,
                    Err(error) => {
                        log::warn!("mpv event error: {error}");
                        continue;
                    }
                };

                let track = || current_track.lock().expect("track mutex").clone();

                match event {
                    Event::StartFile => {
                        duration_ms = None;
                        emit(&sink, PlaybackEvent::Status { status: PlaybackStatus::Loading });
                    }
                    Event::PlaybackRestart => {
                        emit(&sink, PlaybackEvent::Status { status: PlaybackStatus::Playing });
                    }
                    Event::EndFile(reason) => match reason {
                        libmpv2::mpv_end_file_reason::Eof => {
                            emit(&sink, PlaybackEvent::Status { status: PlaybackStatus::Ended });
                            emit(&sink, PlaybackEvent::Ended { track_id: track() });
                        }
                        libmpv2::mpv_end_file_reason::Error => {
                            // mpv does not hand the failure text to this event,
                            // so the log is where the real cause lives.
                            emit(
                                &sink,
                                PlaybackEvent::Error {
                                    track_id: track(),
                                    message: "playback failed — the stream may have expired or \
                                              been rejected"
                                        .into(),
                                },
                            );
                        }
                        // Stop and Quit are our own doing; a redirect is mpv
                        // resolving the URL, not the end of anything.
                        _ => {}
                    },
                    Event::PropertyChange { change, reply_userdata, .. } => match reply_userdata {
                        OBSERVE_TIME_POS => {
                            if let libmpv2::events::PropertyData::Double(seconds) = change {
                                emit(
                                    &sink,
                                    PlaybackEvent::Position {
                                        position_ms: seconds_to_ms(seconds),
                                        duration_ms,
                                    },
                                );
                            }
                        }
                        OBSERVE_DURATION => {
                            if let libmpv2::events::PropertyData::Double(seconds) = change {
                                duration_ms = Some(seconds_to_ms(seconds));
                            }
                        }
                        OBSERVE_PAUSE => {
                            if let libmpv2::events::PropertyData::Flag(paused) = change {
                                emit(
                                    &sink,
                                    PlaybackEvent::Status {
                                        status: if paused {
                                            PlaybackStatus::Paused
                                        } else {
                                            PlaybackStatus::Playing
                                        },
                                    },
                                );
                            }
                        }
                        _ => {}
                    },
                    Event::Shutdown => break,
                    _ => {}
                }
            }
        })
        .expect("spawning the mpv event thread");
}

fn emit(sink: &Sink, event: PlaybackEvent) {
    let guard = sink.lock().expect("sink mutex");
    if let Some(sink) = guard.as_ref() {
        sink.send(event);
    }
}
