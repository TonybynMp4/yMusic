# Logging

The Rust core logs through `tracing`. One subscriber, set up in `src-tauri/src/logging.rs` before Tauri's builder runs, so plugin initialisation is logged too, writes every line twice: to a file and to stderr. Crates that still log through the `log` crate (tauri, reqwest, keyring, lofty) reach the same subscriber through `tracing-log`, so there is one pipeline and one filter.

## Where logs go

A file per local day in the app's log directory, named `yMusic.<date>.log`, the same date the lines inside are stamped with. A file holds at most 2 MB: a day that outgrows it moves its earlier lines to `yMusic.<date>.1.log`, replacing the last one, so a day takes 4 MB at most. Seven days are kept beside the current one, and older files are deleted as a new day starts.

- Linux: `~/.local/share/dev.tony.ymusic/logs/`
- Windows: `%LOCALAPPDATA%\dev.tony.ymusic\logs\`

The Open logs folder button under Settings, About opens it (`open_logs_folder`). The same lines go to stderr, in colour when stderr is a terminal, so `pnpm tauri dev` and a release binary run from a shell both print them. The directory is only known once Tauri's `setup` runs, so the lines logged before then wait in memory (up to 64 KB) and start the file. If the directory can't be created, the app logs to stderr only and says so there.

The file is written on the calling thread, not through a background worker like tracing-appender's (whose daily rotation also goes by the UTC date and has no size cap). The log is a few lines a minute, and the release build aborts on panic, which would lose whatever a worker still held.

The frontend does not write to this log. The engine's lines (`resolved <id> as itag 774 through WEB_REMIX`, a player client that could not resolve a song) go to the webview's devtools console.

## Changing the level

The default filter is `debug` for everything, with these crates held at `warn` because they log per poll, per connection or per cookie: `zbus`, `polling`, `async_io`, `reqwest`, `hyper`, `hyper_util`, `h2` and `cookie_store`. `RUST_LOG` is applied on top of it, so a directive there for the same target wins and the rest of the defaults stay. A level for everything stricter than `warn` (`error`, `off`) holds those crates to it as well:

```sh
RUST_LOG=ymusic_lib=trace pnpm tauri dev    # more from the app, the rest as usual
RUST_LOG=zbus=debug pnpm tauri dev          # MPRIS chatter back
RUST_LOG=warn ./ymusic                      # warnings and errors only
```

A `RUST_LOG` that doesn't parse is ignored, with a warning as the first line of the log.

## Reading spans

A span names the work a line belongs to, and fmt prints the open spans before the message, outermost first, with their fields:

```
2026-11-15 14:02:11.481  WARN mpv_events: ymusic_lib::playback: mpv could not play the stream track_id="yt:bkApuQWCPdM" error=Raw(-13)
2026-11-15 14:02:11.902 DEBUG load{track_id=yt:bkApuQWCPdM attempt=2 player_client="VISIONOS" itag=251 paused=false}: ymusic_lib::playback: loading
```

Spans print nothing when they open or close, so they add context, not lines. Each of these async or threaded paths has one:

- `load` (`Player::load`): the track, which `attempt` (2 is the queue's retry on another player client after mpv refused the first lease), the player client and itag that resolved the lease, and the start position. The queue calls `queue_next` for the gapless append, with `after` and `next`.
- `mpv_events`: mpv's event thread. It outlives every song, so each line in it carries `track_id` as a field.
- `http`: one engine request through `http_fetch`, with `method`, `host` and `path` (no path for googlevideo, whose paths can hold the stream signature). A response other than 2xx logs its status at debug.
- `scan`: one library folder. At debug, each file that would not index and a summary of what was added, updated, unchanged, removed and failed.
- `account_import` and `import`, with `browser`; `account_refresh`, `account_rotate` and `rotate`; `account_sign_in` and `sign_in`. A command that fails logs its error at debug when its span closes. Work moved to a blocking thread (the keyring read, the sign-in window) carries its caller's span with it.
- `update_check`, with the running version.

Image fetches have no span, since there are dozens per page and nearly all work. The debug lines of one that fails carry its URL and the `attempt`, counted from 1.

## What is never logged

Cookies, tokens, keys and account data. Spans that take one as an argument skip all their arguments (`skip_all`) and name the fields they keep. Stream URLs stay out too, because they carry a signature and can carry a PO token, and so do request queries and headers, which can hold a key or the session cookie. The sign-in window and the session rotation log cookie names and domains, never values, and an import logs how many cookies it read. A browser profile is logged by its name, not its path.

When adding a span or a line, check what its fields print. `#[instrument]` records every argument with `Debug` unless told otherwise, so anything near a session gets `skip_all`, and never `ret`.
