//! The OS media session: MPRIS on Linux, SMTC on Windows, through `souvlaki`.
//!
//! Responsibility is split by who knows what. Play state and position come
//! straight from the mpv event thread, which sees every seek and pause as it
//! happens. Track metadata and volume come from the frontend, which owns the
//! queue and the slider. Key presses go back to the frontend too, because
//! "next" means nothing without the queue.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use tauri::{ipc::Channel, AppHandle, Manager, Runtime, WebviewWindow};

use crate::playback::{EventSink, PlaybackEvent, PlaybackStatus};

/// How far a bare "seek forward" goes when the OS does not say. Matches
/// YouTube's own `j`/`l` step.
const DEFAULT_SEEK_STEP: Duration = Duration::from_secs(10);

/// How far a reported position may drift from where the session thinks it is
/// before it is re-reported. Large enough to ignore event jitter, small enough
/// that any real seek crosses it.
const DRIFT_TOLERANCE_MS: u64 = 1500;

/// A media key or widget action, as the frontend handles it.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MediaKeyEvent {
    Play,
    Pause,
    Toggle,
    Next,
    Previous,
    Stop,
    #[serde(rename_all = "camelCase")]
    SeekBy { offset_ms: i64 },
    #[serde(rename_all = "camelCase")]
    SetPosition { position_ms: u64 },
    /// A slider position in 0..=1, the same unit the player's volume takes.
    SetVolume { volume: f64 },
}

/// What the frontend knows about the current track.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTrack {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    /// A remote image, for YouTube tracks.
    pub cover_url: Option<String>,
    /// A file on disk, for local tracks. Kept separate from `cover_url`
    /// because each OS wants a file spelled differently; see `file_cover_url`.
    pub cover_path: Option<String>,
    pub duration_ms: Option<u64>,
}

/// The last playback state handed to the OS, and when.
#[derive(Clone, Copy)]
struct Reported {
    playing: bool,
    position_ms: u64,
    at: Instant,
}

impl Reported {
    /// Where the OS believes playback is now, extrapolating while playing the
    /// way MPRIS clients do.
    fn expected_position_ms(&self) -> u64 {
        if self.playing {
            self.position_ms + self.at.elapsed().as_millis() as u64
        } else {
            self.position_ms
        }
    }
}

#[derive(Default)]
struct State {
    controls: Option<MediaControls>,
    frontend: Option<Channel<MediaKeyEvent>>,
    /// Latest position from mpv, reported or not.
    position_ms: u64,
    /// Whether a file is loaded. mpv reports its `pause` property the moment
    /// it is observed, file or no file, and that must not reach the OS as
    /// "playing" on an empty player.
    loaded: bool,
    /// None until something has played, and again after a stop.
    reported: Option<Reported>,
}

/// Cloneable handle to the session; the player's observer and the Tauri
/// state are both one of these.
#[derive(Clone, Default)]
pub struct MediaSession {
    state: Arc<Mutex<State>>,
}

impl MediaSession {
    /// Registers with the OS. A desktop without a session bus, or a Windows
    /// build that cannot reach SMTC, gets a player without media keys rather
    /// than a player that will not start.
    pub fn attach<R: Runtime>(window: &WebviewWindow<R>) -> Self {
        let session = Self::default();
        match create_controls(window, session.clone(), window.app_handle().clone()) {
            Ok(controls) => session.lock().controls = Some(controls),
            Err(error) => log::warn!("media keys unavailable: {error}"),
        }
        session
    }

    pub fn subscribe(&self, channel: Channel<MediaKeyEvent>) {
        self.lock().frontend = Some(channel);
    }

    pub fn set_track(&self, track: Option<MediaTrack>) {
        let mut state = self.lock();
        let Some(controls) = state.controls.as_mut() else { return };

        let cover = track.as_ref().and_then(|t| match (&t.cover_path, &t.cover_url) {
            (Some(path), _) => Some(file_cover_url(path)),
            (None, Some(url)) => Some(url.clone()),
            (None, None) => None,
        });
        let metadata = match &track {
            Some(track) => MediaMetadata {
                title: Some(&track.title),
                artist: Some(&track.artist),
                album: track.album.as_deref(),
                cover_url: cover.as_deref(),
                duration: track.duration_ms.map(Duration::from_millis),
            },
            None => MediaMetadata::default(),
        };
        if let Err(error) = controls.set_metadata(metadata) {
            log::warn!("could not update media metadata: {error:?}");
        }
    }

    /// Only MPRIS has a volume to report; SMTC leaves volume to the system.
    pub fn set_volume(&self, volume: f64) {
        #[cfg(target_os = "linux")]
        if let Some(controls) = self.lock().controls.as_mut() {
            if let Err(error) = controls.set_volume(volume.clamp(0.0, 1.0)) {
                log::warn!("could not update media volume: {error:?}");
            }
        }
        #[cfg(not(target_os = "linux"))]
        let _ = volume;
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().expect("media session mutex")
    }

    fn forward(&self, event: MediaKeyEvent) {
        if let Some(channel) = self.lock().frontend.as_ref() {
            if let Err(error) = channel.send(event) {
                log::warn!("dropping media key event, channel closed: {error}");
            }
        }
    }
}

/// Mirrors mpv's play state into the OS session.
///
/// Positions are not pushed on every tick: MPRIS clients extrapolate from the
/// last report while playing, so a report per status change is enough, plus
/// one whenever the real position leaves the extrapolated one, which is what a
/// seek looks like from here.
impl EventSink for MediaSession {
    fn send(&self, event: PlaybackEvent) {
        let mut state = self.lock();
        let playback = match event {
            PlaybackEvent::Position { position_ms, .. } => {
                state.position_ms = position_ms;
                match state.reported {
                    Some(reported)
                        if reported.expected_position_ms().abs_diff(position_ms)
                            > DRIFT_TOLERANCE_MS =>
                    {
                        Some(reported.playing)
                    }
                    _ => None,
                }
                .map(|playing| (playing, position_ms))
            }
            PlaybackEvent::Status { status } => match status {
                PlaybackStatus::Playing if state.loaded => Some((true, state.position_ms)),
                PlaybackStatus::Paused if state.loaded => Some((false, state.position_ms)),
                PlaybackStatus::Playing | PlaybackStatus::Paused => None,
                PlaybackStatus::Idle | PlaybackStatus::Ended => {
                    state.loaded = false;
                    state.position_ms = 0;
                    state.reported = None;
                    if let Some(controls) = state.controls.as_mut() {
                        let _ = controls.set_playback(MediaPlayback::Stopped);
                    }
                    None
                }
                // The next status settles it; reporting "loading" as paused
                // would flash the OS widget for every track change.
                PlaybackStatus::Loading => {
                    state.loaded = true;
                    state.position_ms = 0;
                    None
                }
            },
            PlaybackEvent::Ended { .. } | PlaybackEvent::Error { .. } => None,
        };

        let Some((playing, position_ms)) = playback else { return };
        state.reported = Some(Reported { playing, position_ms, at: Instant::now() });
        let progress = Some(MediaPosition(Duration::from_millis(position_ms)));
        let playback = if playing {
            MediaPlayback::Playing { progress }
        } else {
            MediaPlayback::Paused { progress }
        };
        if let Some(controls) = state.controls.as_mut() {
            if let Err(error) = controls.set_playback(playback) {
                log::warn!("could not update media playback state: {error:?}");
            }
        }
    }
}

fn create_controls<R: Runtime>(
    window: &WebviewWindow<R>,
    session: MediaSession,
    app: AppHandle<R>,
) -> Result<MediaControls, String> {
    #[cfg(target_os = "windows")]
    let hwnd = Some(window.hwnd().map_err(|e| e.to_string())?.0 as *mut std::ffi::c_void);
    #[cfg(not(target_os = "windows"))]
    let hwnd = {
        let _ = window;
        None
    };

    let config = PlatformConfig {
        display_name: "yMusic",
        // Becomes `org.mpris.MediaPlayer2.ytbm` on the session bus.
        dbus_name: "ytbm",
        hwnd,
    };
    let mut controls = MediaControls::new(config).map_err(|e| format!("{e:?}"))?;
    controls
        .attach(move |event| handle(&session, &app, event))
        .map_err(|e| format!("{e:?}"))?;
    // souvlaki starts out claiming "Playing", which puts an empty entry with a
    // pause button in the desktop's media widget before anything has loaded.
    controls.set_playback(MediaPlayback::Stopped).map_err(|e| format!("{e:?}"))?;
    Ok(controls)
}

/// Raise and Quit are about the window, so they are handled here; everything
/// else is about the queue or the transport and goes to the frontend.
fn handle<R: Runtime>(session: &MediaSession, app: &AppHandle<R>, event: MediaControlEvent) {
    let forwarded = match event {
        MediaControlEvent::Play => MediaKeyEvent::Play,
        MediaControlEvent::Pause => MediaKeyEvent::Pause,
        MediaControlEvent::Toggle => MediaKeyEvent::Toggle,
        MediaControlEvent::Next => MediaKeyEvent::Next,
        MediaControlEvent::Previous => MediaKeyEvent::Previous,
        MediaControlEvent::Stop => MediaKeyEvent::Stop,
        MediaControlEvent::Seek(direction) => seek_by(direction, DEFAULT_SEEK_STEP),
        MediaControlEvent::SeekBy(direction, amount) => seek_by(direction, amount),
        MediaControlEvent::SetPosition(MediaPosition(position)) => {
            MediaKeyEvent::SetPosition { position_ms: position.as_millis() as u64 }
        }
        MediaControlEvent::SetVolume(volume) => {
            MediaKeyEvent::SetVolume { volume: volume.clamp(0.0, 1.0) }
        }
        MediaControlEvent::Raise => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            return;
        }
        MediaControlEvent::Quit => {
            app.exit(0);
            return;
        }
        // We advertise no URI schemes, so nothing should send this.
        MediaControlEvent::OpenUri(_) => return,
    };
    session.forward(forwarded);
}

fn seek_by(direction: SeekDirection, amount: Duration) -> MediaKeyEvent {
    let ms = amount.as_millis() as i64;
    MediaKeyEvent::SeekBy {
        offset_ms: match direction {
            SeekDirection::Forward => ms,
            SeekDirection::Backward => -ms,
        },
    }
}

/// A local file as each OS's media session wants it. MPRIS wants a real URI,
/// so the path is percent-encoded; souvlaki's Windows backend strips
/// `file://` and opens what is left as a path, so there it must stay raw.
fn file_cover_url(path: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("file://{path}")
    } else {
        format!("file://{}", percent_encode_path(path))
    }
}

fn percent_encode_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_urls_are_percent_encoded_for_mpris() {
        if cfg!(target_os = "windows") {
            return;
        }
        assert_eq!(
            file_cover_url("/home/me/My Music/art/ab#c.jpg"),
            "file:///home/me/My%20Music/art/ab%23c.jpg"
        );
        assert_eq!(file_cover_url("/tmp/é.png"), "file:///tmp/%C3%A9.png");
    }

    #[test]
    fn a_seek_is_reported_but_steady_playback_is_not() {
        let session = MediaSession::default();
        let reported = || session.lock().reported.map(|r| r.position_ms);

        session.send(PlaybackEvent::Status { status: PlaybackStatus::Loading });
        session.send(PlaybackEvent::Status { status: PlaybackStatus::Playing });
        assert_eq!(reported(), Some(0));

        // Ordinary ticks stay within the extrapolation, so nothing is re-sent.
        session.send(PlaybackEvent::Position { position_ms: 250, duration_ms: None });
        assert_eq!(reported(), Some(0));

        // A jump well past where playback could have got to is a seek.
        session.send(PlaybackEvent::Position { position_ms: 60_000, duration_ms: None });
        assert_eq!(reported(), Some(60_000));

        session.send(PlaybackEvent::Status { status: PlaybackStatus::Idle });
        assert_eq!(reported(), None);
    }

    #[test]
    fn an_empty_player_is_never_reported_as_playing() {
        let session = MediaSession::default();
        // What mpv sends when its `pause` property is first observed.
        session.send(PlaybackEvent::Status { status: PlaybackStatus::Playing });
        assert!(session.lock().reported.is_none());
    }

    #[test]
    fn pausing_reports_the_position_it_paused_at() {
        let session = MediaSession::default();
        session.send(PlaybackEvent::Status { status: PlaybackStatus::Loading });
        session.send(PlaybackEvent::Status { status: PlaybackStatus::Playing });
        session.send(PlaybackEvent::Position { position_ms: 42_000, duration_ms: None });
        session.send(PlaybackEvent::Status { status: PlaybackStatus::Paused });
        let reported = session.lock().reported.expect("reported");
        assert!(!reported.playing);
        assert_eq!(reported.position_ms, 42_000);
    }
}
