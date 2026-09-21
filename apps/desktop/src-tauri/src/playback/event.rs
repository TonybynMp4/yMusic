//! Events the player pushes at the frontend. The shape mirrors `PlaybackEvent`
//! in `@ymusic/core`, which is the interface the queue is written against.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackStatus {
    Idle,
    Loading,
    Playing,
    Paused,
    Ended,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PlaybackEvent {
    #[serde(rename_all = "camelCase")]
    Status { status: PlaybackStatus },
    #[serde(rename_all = "camelCase")]
    Position {
        position_ms: u64,
        duration_ms: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Ended { track_id: Option<String> },
    #[serde(rename_all = "camelCase")]
    Error {
        track_id: Option<String>,
        message: String,
    },
}

pub fn seconds_to_ms(seconds: f64) -> u64 {
    if !seconds.is_finite() || seconds <= 0.0 {
        0
    } else {
        (seconds * 1000.0).round() as u64
    }
}
