# Settings

Settings is a full page, opened from the account menu (signed in or not), like an album or playlist page, so Back returns to where you were. It has sections for Account, Playback, Library, Privacy, App and About.

## Storage

`src-tauri/src/settings.rs` keeps the settings as `settings.json` in the app data directory, next to `library.sqlite3` and `account.bin`. Every field has a default and the struct is read with `#[serde(default)]`, so a file from an older build (missing a field) or a newer one (with a field this build doesn't know) still loads. A file that won't parse is logged and replaced by the defaults. Writes go to `settings.json.partial` and are renamed over the old file, so a crash mid-write keeps the previous settings.

Two commands:

- `settings_get` returns everything.
- `settings_set` takes a partial patch. An unknown key or a wrong type is rejected and nothing changes. It saves, then applies whatever Rust owns (mpv options and the tray), and returns the full result.

`main.tsx` reads the settings before the first render, with a top-level `await`, so nothing renders with defaults and then flips. `useSettings` updates optimistically and re-reads from Rust if a save fails. Outside Tauri the defaults from the zod schema in `packages/ipc/src/settings.ts` are used and nothing is saved. That schema mirrors the Rust struct, defaults included.

Rust applies the mpv settings itself at startup, right after `Player::new()`, so the frontend never has to replay them.

## What each setting does

**Autoplay** is the queue's switch, now remembered.

**Audio quality** picks among YouTube's audio-only formats: High takes the highest bitrate, Low the lowest, Normal the one nearest 128 kbps. Leases already resolved are dropped when it changes, so it applies from the next song. Premium's 256 kbps format isn't wired up yet, so it isn't offered.

**Stable volume** is Off, On, or Only loud songs. It uses the `loudness_db` YouTube reports for each format, carried on the lease as `loudnessDb`: how far the track sits above YouTube's reference level, or below it when negative. Before `loadfile`, mpv's `af` is set to move the track to the reference.

- A loud track, X dB over, gets `lavfi=[volume=-XdB]` in both modes.
- A quiet track, with On, is turned up by at most 6 dB, through `alimiter` holding peaks at -1 dBFS. A quiet track can still peak at full scale, and a plain boost would clip it. The cap is there because the limiter flattens the loudest moments of a dynamic track by up to the boost. Only loud songs leaves quiet tracks alone.
- Local files use mpv's `replaygain=track` in both modes, which reads their ReplayGain tags and uses their peak tags to avoid clipping.

Switching it mid-song applies to that song. `tests/volume.rs` renders a tone through the filters: a loud track comes out 6 dB down, and a boosted full-scale one no louder than -1 dBFS.

**Stats for nerds** shows a panel over the artwork in the expanded player, as YouTube does over a video, refreshed every second. It reads the stream (codec, sample rate, channels, bitrate), YouTube's loudness value, stable volume's gain, and two meters. With the setting on, the `af` chain gets ffmpeg's `ebur128` meter either side of the gain: `@in:lavfi=[ebur128=metadata=1:peak=true]`, the gain, then the same meter labelled `@out`. With no gain there is one meter. mpv publishes each meter's readings as JSON through `af-metadata/<label>`. `ebur128` converts samples to doubles but keeps their rate, so the meters never resample what plays.

- Average loudness is the integrated loudness of the song so far, and Loudness now the last 400 ms, both in LUFS.
- Peak is the loudest true peak so far before the gain, and Peak after stable volume the same after it, in dBTP. With no gain the two are the same.
- For a local file, Stable volume shows its ReplayGain tag (`current-tracks/audio/replaygain-track-gain`). mpv applies ReplayGain in its own volume stage after the `af` chain, so neither meter sees it, and Peak after stable volume reads "-".
- Limiter is how far the limiter pulled peaks down: the input peak plus the gain, minus the output peak. The gain is linear, so any difference is the limiter's work. It reads "Not in use" when stable volume has no limiter in the chain, which is every time it turns a song down.

The meters start again with each song and whenever the setting or stable volume changes, because each rebuilds the `af` chain. They cost a little CPU, so they only run while the setting is on. `tests/volume.rs` plays a full-scale tone boosted 4 dB through both meters and checks the limiter reads about 5 dB.

**Output device** lists mpv's `audio-device-list`, which mpv returns as JSON through the string getter (libmpv2 has no node getter). mpv lists every device of every backend it was built with, so the same speakers appear under PipeWire, PulseAudio and several ALSA names. Only the backend mpv would pick by itself is shown: the first entry after `auto`. A saved device that is unplugged stays in the list as "Disconnected device", and mpv falls back to the default output on its own.

**Pause watch history** stops `useWatchHistory` starting new plays, so nothing new is reported. A play already underway still sends its final report.

**Pause search history** sends searches through a second browsing client with no cookie, so they never reach the account's search history. YouTube's own pause is an account setting the app can't reach. The trade-off is that results aren't personalised while it's on, and the setting says so.

**Library** lists the music folders with add, remove and rescan, using the same `useLibrary` actions as the sidebar.

**Keep playing in the tray** adds a tray icon (Show, Play/Pause, Quit) and makes closing the window hide it. The icon only exists while the setting is on. On Linux, Tauri's tray goes through libayatana-appindicator, loaded at run time; the tray crate panics when it's missing, and release builds abort on panic, so the app first checks with `dlopen` that one of the library names the crate tries will load. Without it the setting logs an error and closing quits as before. `platform_summary` reports the same check as `hasTray`, and the settings page disables the switch and says what to install. The `.deb` recommends `libayatana-appindicator3-1` rather than depending on it.

**Updates.** `update_check` reads GitHub's releases API with its own reqwest client, because the `Http` allowlist stays closed to everything but YouTube. It skips drafts and tags that aren't versions, skips prereleases unless opted in, and compares against the running version with semver. With "Check for updates" on, it runs once at startup, and a newer release shows a notice that links to its page. Installing stays with the in-app updater in PLAN.md.

**About** shows the version, opens the log folder (`open_logs_folder`, from Rust so the webview needs no path permission), and links to the repository and its issues.

**Skip disliked songs** skips a disliked song when the queue moves on to it, but not one you pick. See [Interactions](interactions.md#liking-and-disliking).

## What is not a setting

Gapless playback. The player loads each song with `loadfile <url> replace`, so mpv's `gapless-audio` never has a next file to join, and a switch would do nothing. The next track has to be appended to mpv's playlist instead; PLAN.md has the design.
