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
use serde::{Deserialize, Serialize};

use crate::settings::StableVolume;
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

/// The frontend's sink, which `subscribe` replaces, plus observers that live
/// for the whole run, such as the OS media session. Kept apart so a webview
/// reload re-subscribing cannot knock the media session off the event stream.
#[derive(Clone, Default)]
struct Sink {
    frontend: Arc<Mutex<Option<Box<dyn EventSink>>>>,
    observers: Arc<Mutex<Vec<Box<dyn EventSink>>>>,
}

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
    /// YouTube's loudness for the track, in dB above its reference level.
    #[serde(default)]
    pub loudness_db: Option<f64>,
}

/// An output mpv can play through. `name` is what `audio-device` takes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioDevice {
    pub name: String,
    pub description: String,
}

/// Stable volume's state: whether it is on, and the loudness of the track
/// playing, kept so switching it mid-song applies to that song.
#[derive(Default)]
struct Loudness {
    stable: StableVolume,
    track_db: Option<f64>,
    /// Stats for nerds: measure the audio either side of the gain.
    measure: bool,
}

pub struct Player {
    mpv: Arc<Mpv>,
    /// The frontend's event sink is None until the UI has asked for events,
    /// which is why the event thread tolerates its absence rather than
    /// treating it as an error.
    sink: Sink,
    current_track: Arc<Mutex<Option<String>>>,
    loudness: Mutex<Loudness>,
}

/// libmpv refuses to initialize under a locale where `LC_NUMERIC` is not "C",
/// because its option parser would then read "0,5" for a decimal. GTK sets the
/// locale from the environment during Tauri's startup, so this has to run
/// before the first `mpv_create`, not once at program start, which is too
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
            init.set_property("audio-client-name", "yMusic")?;
            // Tests and headless machines have no audio device; `ao=null`
            // decodes everything and discards the samples, which still
            // exercises the whole path up to the sound card.
            if let Ok(ao) = std::env::var("YMUSIC_AUDIO_OUTPUT") {
                init.set_property("ao", ao.as_str())?;
            }
            Ok(())
        })
        .map_err(|error| format!("could not start libmpv: {error}"))?;

        match mpv.get_property::<String>("mpv-version") {
            Ok(version) => log::info!("playing through {version}"),
            Err(error) => log::warn!("could not read the mpv version: {error}"),
        }

        let mpv = Arc::new(mpv);
        let sink = Sink::default();
        let current_track = Arc::new(Mutex::new(None));

        mpv.observe_property("time-pos", Format::Double, OBSERVE_TIME_POS)
            .map_err(|error| format!("could not observe time-pos: {error}"))?;
        mpv.observe_property("duration", Format::Double, OBSERVE_DURATION)
            .map_err(|error| format!("could not observe duration: {error}"))?;
        mpv.observe_property("pause", Format::Flag, OBSERVE_PAUSE)
            .map_err(|error| format!("could not observe pause: {error}"))?;

        spawn_event_thread(Arc::clone(&mpv), sink.clone(), Arc::clone(&current_track));

        Ok(Self {
            mpv,
            sink,
            current_track,
            loudness: Mutex::default(),
        })
    }

    pub fn subscribe(&self, sink: impl EventSink) {
        *self.sink.frontend.lock().expect("sink mutex") = Some(Box::new(sink));
    }

    /// Adds a permanent listener alongside the frontend's.
    pub fn observe(&self, observer: impl EventSink) {
        self.sink
            .observers
            .lock()
            .expect("observer mutex")
            .push(Box::new(observer));
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

        {
            let mut loudness = self.loudness.lock().expect("loudness mutex");
            loudness.track_db = request.loudness_db;
            if let Err(error) = self.apply_loudness(&loudness) {
                log::warn!("{error}");
            }
        }

        self.set_property("pause", request.start_paused)?;
        self.command("loadfile", &[&request.url, "replace"])
    }

    /// Applies the settings mpv owns. Called at startup and after each change;
    /// a setting mpv refuses is logged rather than failing the others.
    pub fn apply_settings(&self, settings: &crate::settings::Settings) {
        if let Err(error) = self.set_stable_volume(settings.stable_volume) {
            log::warn!("{error}");
        }
        if let Err(error) = self.set_audio_device(&settings.audio_device) {
            log::warn!("{error}");
        }
        if let Err(error) = self.set_stats(settings.stats_for_nerds) {
            log::warn!("{error}");
        }
    }

    /// Stable volume moves YouTube tracks toward YouTube's reference level by
    /// the loudness YouTube measured for them, and has mpv apply ReplayGain
    /// tags to local files.
    pub fn set_stable_volume(&self, mode: StableVolume) -> Result<(), String> {
        let mut loudness = self.loudness.lock().expect("loudness mutex");
        loudness.stable = mode;
        let replaygain = if mode == StableVolume::Off {
            "no"
        } else {
            "track"
        };
        self.set_property("replaygain", replaygain)?;
        self.apply_loudness(&loudness)
    }

    fn apply_loudness(&self, loudness: &Loudness) -> Result<(), String> {
        let gain = stable_volume_filter(loudness.stable, loudness.track_db);
        let filter = if loudness.measure {
            measured_filter(&gain)
        } else {
            gain
        };
        self.set_property("af", filter.as_str())
    }

    /// Turns the stats for nerds meters on or off. They restart from nothing,
    /// as they do at the start of every song.
    pub fn set_stats(&self, on: bool) -> Result<(), String> {
        let mut loudness = self.loudness.lock().expect("loudness mutex");
        if loudness.measure == on {
            return Ok(());
        }
        loudness.measure = on;
        self.apply_loudness(&loudness)
    }

    /// What stats for nerds shows. The meters read nothing while it is off.
    pub fn stats(&self) -> AudioStats {
        let (stable, track_db) = {
            let loudness = self.loudness.lock().expect("loudness mutex");
            (loudness.stable, loudness.track_db)
        };
        let gain_db = stable_volume_gain(stable, track_db);

        let string = |name: &str| self.mpv.get_property::<String>(name).ok();
        let params: Option<serde_json::Value> =
            string("audio-params").and_then(|json| serde_json::from_str(&json).ok());
        let input = string("af-metadata/in").and_then(|json| Meter::parse(&json));
        let output = string("af-metadata/out").and_then(|json| Meter::parse(&json));
        let peak_db = input.as_ref().and_then(|m| m.peak_db);
        let output_peak_db = output.as_ref().and_then(|m| m.peak_db);
        // mpv applies a local file's ReplayGain after the `af` chain, where
        // neither meter sees it.
        let replaygain_db = if stable == StableVolume::Off {
            None
        } else {
            self.mpv
                .get_property::<f64>("current-tracks/audio/replaygain-track-gain")
                .ok()
        };

        AudioStats {
            codec: string("audio-codec-name"),
            sample_rate: params.as_ref().and_then(|p| p.get("samplerate")?.as_u64()),
            channels: params
                .as_ref()
                .and_then(|p| Some(p.get("hr-channels")?.as_str()?.to_string())),
            bitrate: self.mpv.get_property::<i64>("audio-bitrate").ok(),
            youtube_loudness_db: track_db,
            gain_db,
            replaygain_db,
            integrated_lufs: input.as_ref().and_then(|m| m.integrated),
            momentary_lufs: input.as_ref().and_then(|m| m.momentary),
            peak_db,
            // With no gain there is no `out` meter, and nothing between the
            // two: the output peak is the input's, unless ReplayGain moved it.
            output_peak_db: match (gain_db, replaygain_db) {
                (Some(_), _) => output_peak_db,
                (None, None) => peak_db,
                (None, Some(_)) => None,
            },
            limiter_db: match (gain_db, peak_db, output_peak_db) {
                (Some(gain), Some(peak), Some(out)) if has_limiter(gain) => {
                    Some(limiter_reduction(peak, gain, out))
                }
                _ => None,
            },
        }
    }

    /// The outputs to offer, on the audio backend mpv would pick by itself.
    ///
    /// mpv lists every device of every backend it was built with, so the same
    /// speakers show up under PipeWire, PulseAudio and several ALSA names. The
    /// first entry after `auto` is the default of the preferred backend, and
    /// its devices are the ones worth showing.
    pub fn audio_devices(&self) -> Result<Vec<AudioDevice>, String> {
        let json = self
            .mpv
            .get_property::<String>("audio-device-list")
            .map_err(|error| format!("could not list audio devices: {error}"))?;
        let devices: Vec<AudioDevice> = serde_json::from_str(&json)
            .map_err(|error| format!("unexpected audio device list: {error}"))?;
        Ok(preferred_devices(devices))
    }

    /// `auto` follows the system's default output. A saved device that has
    /// since gone away also plays through the default, which mpv does itself.
    pub fn set_audio_device(&self, name: &str) -> Result<(), String> {
        self.set_property("audio-device", name)
    }

    pub fn play(&self) -> Result<(), String> {
        self.set_property("pause", false)
    }

    pub fn pause(&self) -> Result<(), String> {
        self.set_property("pause", true)
    }

    pub fn toggle_pause(&self) -> Result<(), String> {
        self.command("cycle", &["pause"])
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
        emit(
            &self.sink,
            PlaybackEvent::Status {
                status: PlaybackStatus::Idle,
            },
        );
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

/// The most a quiet track is turned up. Past this the limiter would be
/// flattening a dynamic track's loudest moments by more than it is worth.
pub const MAX_BOOST_DB: f64 = 6.0;

/// The `af` value that plays a track `loudness_db` above YouTube's reference
/// (below it, when negative) at the reference instead. Empty, so no filter,
/// when there is nothing to change.
///
/// A boost goes through a limiter holding peaks at -1 dBFS: a quiet track can
/// still have peaks at full scale, which a plain gain would clip. It leaves
/// everything under that ceiling untouched.
pub fn stable_volume_filter(mode: StableVolume, loudness_db: Option<f64>) -> String {
    match stable_volume_gain(mode, loudness_db) {
        None => String::new(),
        Some(gain) if has_limiter(gain) => {
            format!("lavfi=[volume={gain:.2}dB,alimiter=limit=0.891:level=disabled]")
        }
        Some(gain) => format!("lavfi=[volume={gain:.2}dB]"),
    }
}

/// Whether stable volume puts `gain_db` through the limiter: a boost can
/// clip, a cut cannot.
pub fn has_limiter(gain_db: f64) -> bool {
    gain_db > 0.0
}

/// The gain stable volume applies, in dB: negative turns a loud track down,
/// positive turns a quiet one up. None when it leaves the track alone.
pub fn stable_volume_gain(mode: StableVolume, loudness_db: Option<f64>) -> Option<f64> {
    match (mode, loudness_db) {
        (StableVolume::Off, _) | (_, None) => None,
        (_, Some(db)) if db > 0.0 => Some(-db),
        (StableVolume::On, Some(db)) if db < 0.0 => Some((-db).min(MAX_BOOST_DB)),
        _ => None,
    }
}

/// The meter ffmpeg's `ebur128` filter runs, publishing through mpv's
/// `af-metadata/<label>`: loudness per EBU R128, and the true peak so far.
/// It converts samples to doubles but keeps their rate, so it changes nothing
/// that plays.
const METER: &str = "lavfi=[ebur128=metadata=1:peak=true]";

/// `gain` between two meters, `in` before it and `out` after it. With no gain
/// there is nothing to compare, and one meter is enough.
pub fn measured_filter(gain: &str) -> String {
    if gain.is_empty() {
        format!("@in:{METER}")
    } else {
        format!("@in:{METER},{gain},@out:{METER}")
    }
}

/// How far the limiter pulled the loudest peak down, in dB. The gain is
/// linear, so without the limiter the output peak would be the input's plus
/// the gain exactly; measurement noise under 0.05 dB reads as none.
pub fn limiter_reduction(peak_db: f64, gain_db: f64, output_peak_db: f64) -> f64 {
    let reduction = peak_db + gain_db - output_peak_db;
    if reduction < 0.05 {
        0.0
    } else {
        reduction
    }
}

/// Stats for nerds, for the song playing. Each is None when mpv or the meters
/// have nothing to say yet.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStats {
    pub codec: Option<String>,
    pub sample_rate: Option<u64>,
    pub channels: Option<String>,
    /// Bits per second, as mpv estimates it from the stream.
    pub bitrate: Option<i64>,
    /// How far YouTube measured the track above its reference level.
    pub youtube_loudness_db: Option<f64>,
    /// Stable volume's gain; None when it leaves the track alone.
    pub gain_db: Option<f64>,
    /// The ReplayGain tag mpv applies to a local file with stable volume on.
    pub replaygain_db: Option<f64>,
    /// Loudness over the song so far, in LUFS: its average level.
    pub integrated_lufs: Option<f64>,
    /// Loudness over the last 400 ms.
    pub momentary_lufs: Option<f64>,
    /// The track's loudest true peak so far, before the gain, in dBTP.
    pub peak_db: Option<f64>,
    /// The loudest true peak after the gain and limiter. None under
    /// ReplayGain, which no meter sees.
    pub output_peak_db: Option<f64>,
    /// How far the limiter pulled peaks down; None when there is no limiter.
    pub limiter_db: Option<f64>,
}

/// One `ebur128` meter's readings.
struct Meter {
    integrated: Option<f64>,
    momentary: Option<f64>,
    peak_db: Option<f64>,
}

impl Meter {
    /// mpv gives filter metadata as a JSON object of strings.
    fn parse(json: &str) -> Option<Self> {
        let values: HashMap<String, String> = serde_json::from_str(json).ok()?;
        let number = |key: &str| values.get(key)?.parse::<f64>().ok();
        // ebur128 reports silence as -70 LUFS or below; that is no reading.
        let loudness = |key: &str| number(key).filter(|lufs| *lufs > -70.0);
        Some(Self {
            integrated: loudness("lavfi.r128.I"),
            momentary: loudness("lavfi.r128.M"),
            peak_db: number("lavfi.r128.true_peak")
                .filter(|linear| *linear > 0.0)
                .map(|linear| 20.0 * linear.log10()),
        })
    }
}

/// Leaves out mpv's own `auto` entry: the settings page offers it as "System
/// default" itself, and would otherwise list it twice.
fn preferred_devices(devices: Vec<AudioDevice>) -> Vec<AudioDevice> {
    let devices: Vec<AudioDevice> = devices.into_iter().filter(|d| d.name != "auto").collect();
    let Some(backend) = devices.first().map(|d| d.name.as_str()) else {
        return devices;
    };
    let prefix = format!("{}/", backend.split('/').next().unwrap_or(backend));
    let preferred: Vec<AudioDevice> = devices
        .iter()
        .filter(|d| d.name.starts_with(&prefix))
        .cloned()
        .collect();
    if preferred.is_empty() {
        devices
    } else {
        preferred
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
                let track = || current_track.lock().expect("track mutex").clone();

                // libmpv2 hands an `END_FILE` that carries an error back as
                // this `Err`, never as `EndFile(Error)`. Nothing here makes
                // async requests, so the error is a file that failed to load,
                // and the queue has to hear about it to retry on the fallback
                // client rather than sit there loading.
                let event = match event {
                    Ok(event) => event,
                    Err(error) => {
                        log::warn!("mpv could not play the stream: {error}");
                        emit(
                            &sink,
                            PlaybackEvent::Error {
                                track_id: track(),
                                message: format!(
                                    "playback failed: the stream may have expired or been \
                                     rejected ({error})"
                                ),
                            },
                        );
                        continue;
                    }
                };

                match event {
                    Event::StartFile => {
                        duration_ms = None;
                        emit(
                            &sink,
                            PlaybackEvent::Status {
                                status: PlaybackStatus::Loading,
                            },
                        );
                    }
                    // mpv restarts playback after every seek too, including a
                    // seek while paused, so "playing" has to be checked rather
                    // than assumed or a paused scrub flips the UI to playing.
                    Event::PlaybackRestart => {
                        let paused = mpv.get_property::<bool>("pause").unwrap_or(false);
                        let status = if paused {
                            PlaybackStatus::Paused
                        } else {
                            PlaybackStatus::Playing
                        };
                        emit(&sink, PlaybackEvent::Status { status });
                    }
                    Event::EndFile(reason) => match reason {
                        libmpv2::mpv_end_file_reason::Eof => {
                            emit(
                                &sink,
                                PlaybackEvent::Status {
                                    status: PlaybackStatus::Ended,
                                },
                            );
                            emit(&sink, PlaybackEvent::Ended { track_id: track() });
                        }
                        // Unreachable through libmpv2 today (see above), and
                        // kept in case a release starts sending it.
                        libmpv2::mpv_end_file_reason::Error => {
                            emit(
                                &sink,
                                PlaybackEvent::Error {
                                    track_id: track(),
                                    message: "playback failed: the stream may have expired or \
                                              been rejected"
                                        .into(),
                                },
                            );
                        }
                        // Stop and Quit are our own doing; a redirect is mpv
                        // resolving the URL, not the end of anything.
                        _ => {}
                    },
                    Event::PropertyChange {
                        change,
                        reply_userdata,
                        ..
                    } => match reply_userdata {
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
    for observer in sink.observers.lock().expect("observer mutex").iter() {
        observer.send(event.clone());
    }
    if let Some(frontend) = sink.frontend.lock().expect("sink mutex").as_ref() {
        frontend.send(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(name: &str) -> AudioDevice {
        AudioDevice {
            name: name.into(),
            description: name.into(),
        }
    }

    #[test]
    fn devices_come_from_the_preferred_backend() {
        let devices = vec![
            device("auto"),
            device("pipewire"),
            device("pipewire/speakers"),
            device("pipewire/hdmi"),
            device("pulse/speakers"),
            device("alsa"),
            device("alsa/hw:0"),
        ];
        let names: Vec<_> = preferred_devices(devices)
            .into_iter()
            .map(|d| d.name)
            .collect();
        assert_eq!(names, ["pipewire/speakers", "pipewire/hdmi"]);
    }

    #[test]
    fn a_meter_reads_loudness_and_converts_the_peak_to_db() {
        let meter = Meter::parse(
            r#"{"lavfi.r128.I":"-14.2","lavfi.r128.M":"-70.0","lavfi.r128.true_peak":"0.5"}"#,
        )
        .expect("a reading");
        assert_eq!(meter.integrated, Some(-14.2));
        assert_eq!(meter.momentary, None, "silence is no reading");
        let peak = meter.peak_db.expect("a peak");
        assert!(
            (peak + 6.02).abs() < 0.01,
            "half scale is -6 dB, got {peak}"
        );
    }

    #[test]
    fn a_silent_meter_has_no_peak() {
        let meter = Meter::parse(r#"{"lavfi.r128.true_peak":"0"}"#).expect("a reading");
        assert_eq!(meter.peak_db, None);
        assert!(Meter::parse("not json").is_none());
    }

    #[test]
    fn a_backend_without_named_devices_lists_everything_but_auto() {
        let devices = vec![device("auto"), device("null")];
        assert_eq!(preferred_devices(devices), vec![device("null")]);
    }
}
