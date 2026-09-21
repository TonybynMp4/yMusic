//! Drives the commands the way the frontend does, through Tauri's IPC layer on
//! a mock runtime, so an argument name or payload shape that only the webview
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

use ymusic_lib::{
    account::{Account, MemoryKeys},
    library::Library,
    platform::media::MediaSession,
    playback::{EventSink, PlaybackEvent, Player},
    ymusic_commands,
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
    std::env::set_var("YMUSIC_AUDIO_OUTPUT", "null");

    let app = mock_builder()
        .invoke_handler(ymusic_commands!())
        .build(tauri::generate_context!())
        .expect("mock app");
    let player = Player::new().expect("libmpv");
    let loaded = LoadedFlag::default();
    player.subscribe(loaded.clone());
    app.manage(player);

    // Default rather than `attach`: no OS session is registered, which is also
    // the path a desktop without a session bus takes.
    app.manage(MediaSession::default());

    let art_dir = std::env::temp_dir().join(format!("ymusic-ipc-art-{}", std::process::id()));
    app.manage(Library::open_in_memory(art_dir).expect("in-memory library"));
    let account_path = std::env::temp_dir()
        .join(format!("ymusic-ipc-account-{}", std::process::id()))
        .join("account.bin");
    app.manage(Account::open(account_path, MemoryKeys::default()));

    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock webview");

    // Returns a payload, so this also pins the serde casing the frontend parses.
    let summary = get_ipc_response(&webview, request("platform_summary", serde_json::json!({})))
        .expect("platform_summary should succeed")
        .deserialize::<serde_json::Value>()
        .expect("summary json");
    for field in [
        "os",
        "arch",
        "appVersion",
        "installFlavor",
        "supportsInAppUpdate",
    ] {
        assert!(
            summary.get(field).is_some(),
            "missing `{field}` in {summary}"
        );
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
            "headers": { "User-Agent": "YMUSIC/0.1", "Cookie": "a=1, b=2" },
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
        (
            "media_set_track",
            serde_json::json!({ "track": {
                "title": "Tone",
                "artist": "Fixture",
                "album": null,
                "coverUrl": null,
                "coverPath": "/tmp/cover art.jpg",
                "durationMs": 3000
            } }),
        ),
        ("media_set_track", serde_json::json!({ "track": null })),
        ("media_set_volume", serde_json::json!({ "volume": 0.5 })),
        // `account_sign_in` opens a real Google page, so it stays out of here.
        ("account_sign_out", serde_json::json!({})),
    ];
    let cookie = get_ipc_response(&webview, request("account_cookie", serde_json::json!({})))
        .expect("account_cookie should succeed")
        .deserialize::<Option<String>>()
        .expect("cookie json");
    assert_eq!(cookie, None, "a fresh account is signed out");

    for (command, body) in calls {
        get_ipc_response(&webview, request(command, body))
            .unwrap_or_else(|error| panic!("`{command}` failed over IPC: {error}"));
    }
}

/// The library half of the surface, driven the same way. Kept separate from the
/// player test because it needs no audio device and no waiting.
#[test]
fn library_commands_round_trip_over_ipc() {
    let app = mock_builder()
        .invoke_handler(ymusic_commands!())
        .build(tauri::generate_context!())
        .expect("mock app");

    let home = std::env::temp_dir().join(format!("ymusic-ipc-library-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(&home).expect("temp home");
    app.manage(Library::open_in_memory(home.join("art")).expect("in-memory library"));

    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock webview");

    let fixtures = format!("{}/tests/fixtures/library", env!("CARGO_MANIFEST_DIR"));

    let report = get_ipc_response(
        &webview,
        request(
            "library_add_folder",
            serde_json::json!({ "path": fixtures }),
        ),
    )
    .expect("library_add_folder should succeed")
    .deserialize::<serde_json::Value>()
    .expect("report json");
    assert_eq!(
        report["added"], 3,
        "adding a folder also scans it: {report}"
    );

    let tracks = get_ipc_response(&webview, request("library_tracks", serde_json::json!({})))
        .expect("library_tracks should succeed")
        .deserialize::<serde_json::Value>()
        .expect("tracks json");
    let tracks = tracks.as_array().expect("an array of tracks");
    assert_eq!(tracks.len(), 3);
    // Pins the casing the zod schema in `packages/ipc` parses.
    for field in [
        "id",
        "path",
        "title",
        "artist",
        "album",
        "albumArtist",
        "trackNumber",
        "discNumber",
        "year",
        "durationMs",
        "codec",
        "bitrate",
        "coverArt",
    ] {
        assert!(
            tracks[0].get(field).is_some(),
            "missing `{field}` in {}",
            tracks[0]
        );
    }

    let found = get_ipc_response(
        &webview,
        request("library_search", serde_json::json!({ "query": "nebula" })),
    )
    .expect("library_search should succeed")
    .deserialize::<serde_json::Value>()
    .expect("search json");
    assert_eq!(found.as_array().expect("array").len(), 2);

    let id = tracks[0]["id"].as_str().expect("a track id");
    let lease = get_ipc_response(
        &webview,
        request("library_resolve", serde_json::json!({ "id": id })),
    )
    .expect("library_resolve should succeed")
    .deserialize::<serde_json::Value>()
    .expect("lease json");
    // The lease must satisfy the same schema a YouTube lease will.
    for field in [
        "trackId",
        "url",
        "itag",
        "codec",
        "bitrate",
        "isPremiumFormat",
        "headers",
        "expiresAt",
    ] {
        assert!(lease.get(field).is_some(), "missing `{field}` in {lease}");
    }
    assert!(lease["expiresAt"].is_null(), "a local file never expires");

    let folders = get_ipc_response(&webview, request("library_folders", serde_json::json!({})))
        .expect("library_folders should succeed")
        .deserialize::<Vec<String>>()
        .expect("folders json");
    assert_eq!(folders.len(), 1);

    get_ipc_response(
        &webview,
        request(
            "library_remove_folder",
            serde_json::json!({ "path": folders[0] }),
        ),
    )
    .expect("library_remove_folder should succeed");

    let after = get_ipc_response(&webview, request("library_tracks", serde_json::json!({})))
        .expect("library_tracks should succeed")
        .deserialize::<Vec<serde_json::Value>>()
        .expect("tracks json");
    assert!(after.is_empty(), "removing the folder removes its tracks");

    get_ipc_response(&webview, request("library_scan", serde_json::json!({})))
        .expect("library_scan should succeed with no folders");

    let _ = std::fs::remove_dir_all(&home);
}
