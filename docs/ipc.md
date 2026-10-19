# The IPC layer

Rust owns the types of everything that crosses between the core and the frontend. `tauri-specta` reads the commands and the types they carry and writes `packages/ipc/src/bindings.ts`, which is committed. The rest of `packages/ipc` wraps those generated commands for the app.

## From Rust to TypeScript

- Each command in `src-tauri/src/commands.rs` has `#[tauri::command]` and `#[specta::specta]`, and each type in an argument, a result or a channel derives `specta::Type`. Serde attributes decide the TypeScript shape, as they decide the JSON.
- `ymusic_specta!` in `lib.rs` lists the commands. It is a macro rather than a function because `collect_commands!` cannot name an outer generic, and the commands that take an `AppHandle` are generic over the runtime: the app builds it for `tauri::Wry`, `tests/commands.rs` for the mock runtime.
- `ymusic_invoke_handler!` is the handler the app and the tests mount. It routes `http_fetch` to Tauri's own handler and everything else to specta's. `http_fetch` takes and returns raw bytes (see [the data engine](engine.md)), which specta has no type for, so its wrapper in `packages/ipc/src/http.ts` stays hand-written and is the one plain `invoke` left.
- Commands reject with their error string, as a plain `invoke` does (`ErrorHandlingMode::Throw`).
- Specta refuses 64-bit integers by default, because JSON numbers lose precision above 2^53. The ones that cross are milliseconds, byte counts and itags, so the builder casts them all to `number`.
- Specta types every `f64` as `number | null`, since serde writes NaN as `null`. `MediaKeyEvent::SetVolume` clamps its volume first, so its field is typed `number`.
- `Settings::default()` is exported as the `defaultSettings` constant, which is what a plain browser gets.
- `settings_set` takes a `SettingsPatch`, one optional field per setting, so a misspelt setting fails `tsc`. Rust also rejects unknown fields at run time.

There are no global events. The two streams, playback and media keys, are `Channel<T>` arguments, so their payloads (`PlaybackEvent`, `MediaKeyEvent`) come through the command types.

## Keeping the bindings current

`pnpm bindings` regenerates the file. `tests/bindings.rs` exports a fresh copy to a temporary file and fails if it differs from the committed one, so CI's `cargo test` catches a Rust change that was not regenerated. A drifted type then fails `tsc` wherever the frontend uses it.

## Where zod still parses

Zod is for data the app does not produce: InnerTube responses, parsed at the engine boundary into the models in `packages/core`. The IPC payloads are not parsed. Rust and the frontend are built from one commit, and the compiler checks both sides against one generated file, so a runtime parse there would only repeat what `tsc` and `cargo test` already proved.

Some Rust types mirror a core schema that also parses YouTube's data: `AudioCodec`, `AudioQuality` and `PlaybackStatus`. The wrappers pin each pair with `Same<A, B>` from `tauri.ts`, so a change to one fails `tsc` until the other matches.

## The wrappers

`call(name, ...args)` in `tauri.ts` runs a generated command, or rejects with `NotInTauriError` in a plain browser. The wrappers built on it keep the app's API stable and do the lifting that needs the frontend:

- Local tracks become core `Track`s, and their cover paths become asset URLs (`library.ts`).
- A local lease becomes a `StreamLease`.
- Playback events become core's `PlaybackEvent` (`player.ts`).

Track ids come back from Rust as plain strings. Rust only echoes ids the frontend sent or mints `local:<hash>` ones, so `rustTrackId` restores the brand without a check.
