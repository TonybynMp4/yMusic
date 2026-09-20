//! Drives the commands the way the frontend does — through Tauri's IPC layer on
//! a mock runtime — so an argument name or payload shape that only the webview
//! would exercise cannot drift unnoticed.

use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, INVOKE_KEY},
    webview::InvokeRequest,
    Manager, WebviewWindowBuilder,
};

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use ytbm_lib::{
    playback::{EventSink, PlaybackEvent, Player},
    ytbm_commands,
};

/// Flips once mpv reports a position, which only happens after `loadfile` has
/// actually opened the file.
#[derive(Clone, Default)]
struct LoadedFlag(Arc<AtomicBool>);

impl EventSink for LoadedFlag {
    fn send(&self, event: PlaybackEvent) {
        if matches!(event, PlaybackEvent::Position { .. }) {
            self.0.store(true, Ordering::SeqCst);
        }
    }
}

fn request(command: &str, body: serde_json::Value) -> InvokeRequest {
    InvokeRequest {
        cmd: command.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "tauri://localhost".parse().expect("mock url"),
        body: InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

#[test]
fn every_command_is_reachable_over_ipc() {
    std::env::set_var("YTBM_AUDIO_OUTPUT", "null");

    let app = mock_builder()
        .invoke_handler(ytbm_commands!())
        .build(tauri::generate_context!())
        .expect("mock app");
    let player = Player::new().expect("libmpv");
    let loaded = LoadedFlag::default();
    player.subscribe(loaded.clone());
    app.manage(player);

    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock webview");

    // Returns a payload, so this also pins the serde casing the frontend parses.
    let summary = get_ipc_response(&webview, request("platform_summary", serde_json::json!({})))
        .expect("platform_summary should succeed")
        .deserialize::<serde_json::Value>()
        .expect("summary json");
    for field in ["os", "arch", "appVersion", "installFlavor", "supportsInAppUpdate"] {
        assert!(summary.get(field).is_some(), "missing `{field}` in {summary}");
    }

    // player_load carries the one non-trivial payload: the lease, headers and
    // all. It goes first because mpv rejects a seek with nothing loaded, which
    // is also the order the app uses.
    let load = serde_json::json!({
        "request": {
            "trackId": "abc123",
            "url": format!("{}/tests/fixtures/tone.wav", env!("CARGO_MANIFEST_DIR")),
            // A comma in a header value would corrupt a comma-joined header
            // list, so this pins the one-at-a-time change-list path.
            "headers": { "User-Agent": "YTBM/0.1", "Cookie": "a=1, b=2" },
            "startPaused": false
        }
    });
    get_ipc_response(&webview, request("player_load", load)).expect("player_load should succeed");

    // `loadfile` is asynchronous: mpv rejects a seek until the file is open, so
    // wait the way the UI does rather than racing it.
    let deadline = Instant::now() + Duration::from_secs(10);
    while !loaded.0.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline, "mpv never opened the fixture");
        std::thread::sleep(Duration::from_millis(50));
    }

    // The transport commands, with the argument names the TS client sends;
    // Tauri maps camelCase onto the snake_case parameters.
    let calls = [
        ("player_set_volume", serde_json::json!({ "volume": 0.5 })),
        ("player_play", serde_json::json!({})),
        ("player_pause", serde_json::json!({})),
        ("player_seek", serde_json::json!({ "positionMs": 1000 })),
        ("player_stop", serde_json::json!({})),
    ];
    for (command, body) in calls {
        get_ipc_response(&webview, request(command, body))
            .unwrap_or_else(|error| panic!("`{command}` failed over IPC: {error}"));
    }
}
