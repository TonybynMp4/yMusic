# Playback

**libmpv in Rust** (`libmpv2`), driven by Tauri commands, with state and position pushed to the frontend over a Tauri `Channel`. Linux links the system `libmpv` and declares it as a package dependency; Windows ships `libmpv-2.dll` beside the binary.

The floor is mpv 0.35, the first release with `libmpv.so.2`. The binary imports ten libmpv functions, all present since client API 2.0, so the library name is the whole requirement. The `.deb` depends on `libmpv2 (>= 0.35)`, and a hand-run binary on an older system stops in the dynamic loader before any of our code runs. If mpv itself fails to start, the app hides its window, shows an error dialog naming the package, and quits when it is closed. The startup log records the loaded version (`playing through mpv v0.41.0`).

The engine resolves an audio-only stream URL and mpv streams it over HTTP range requests, with no local proxy. The raw audio stream has no ads: those live in the web player.

Two details that each cost a day if missed:

- googlevideo binds a stream to the session that resolved it, so mpv gets the same `User-Agent`, cookies and PO token through `http-header-fields`.
- Stream URLs expire after about six hours, so the player re-resolves a track whose lease is stale.

**Gapless.** While a song plays, the queue resolves the next one's lease and calls `player_queue_next`, and Rust appends it to mpv's playlist with `loadfile <url> append`. With `gapless-audio=yes` and `prefetch-playlist=yes`, mpv opens it ahead of time and joins the two with no gap. A song loaded with `replace` drops whatever was appended.

- Stable volume's filter goes on every file as a per-file `af` option, not the global property, or the next song's gain would land on the one still playing. mpv splits per-file options on commas, so the value is quoted by its byte length (`%12%lavfi=[...]`). Every file gets one because mpv restores per-file options when a file ends. Changing stable volume or stats re-appends the next song with the new filter.
- mpv 0.38 added an index argument to `loadfile` (`<url> <flags> <index> <options>`). The player reads the version at startup and leaves the index out before 0.38.
- On `start-file` Rust reads `path`. If it is the appended URL, it emits `Advanced { trackId }` instead of `Ended`, the queue moves to Next without loading, and the 403 retry follows the track mpv reports. If mpv started something else, the queue gets `Ended` and loads its next track as before.
- The queue calls `player_queue_next` again whenever the next track changes (skip, reorder, play next, shuffle, a cleared queue), which runs `playlist-clear` and appends the new one, or nothing. Rust ignores a call meant for a song that is no longer playing. Repeat-one and a disliked next song under "Skip disliked songs" append nothing. Neither does a next track whose headers differ from the current one's, because `http-header-fields` is global.
- mpv keeps the audio device open with the first file's format, so a file at another sample rate (YouTube's Opus is 48 kHz, a local file may be 44.1 kHz) is resampled rather than reopening the device. Silence encoded into the files themselves stays, as on YouTube Music.

The log records each join (`went on to <id> with no gap`).

Volume is perceptual. mpv's `volume` property already applies a cubic taper, so the UI sends the slider position as a linear fraction and never applies the curve again.

The volume carries over between launches. Rust saves two numbers in `volume.json` beside the settings file: the volume, and the last one above zero, which is the level Unmute goes back to. Both are slider fractions.

- Rust observes mpv's `volume` and saves it once it has stayed put for half a second, not at every step of a drag. Watching mpv rather than the slider also catches the GNOME and KDE media widgets, which set the volume over MPRIS. Windows has no equivalent: SMTC leaves volume to the system, so its flyout never reaches mpv.
- The last level above zero comes from those settled values only, as the player bar's own unmute level does. mpv sees every step of a drag, so a drag down to zero would otherwise save a near-silent step as the level to unmute to.
- At launch Rust sets mpv's volume before anything loads, and the frontend reads the saved pair (`player_saved_volume`) before its first render, alongside the settings. The player bar starts from the saved volume, with the last level above zero as the level to unmute to. Quitting while muted comes back muted, and Unmute restores the level from before.
- A change made in the last half second before quitting can be lost: there is nothing to flush on exit.

The queue, in the full player's Up next tab, keeps the playing song in view. Opening it centres that row before the first paint. When the song changes and the new row is out of view, the list scrolls to it, unless the old row was out of view too: then you had scrolled away to read the list, and it stays where you left it. While the playing row is hidden, a "Now playing" button at the top or bottom edge, on the side where the row is, scrolls back to it. The button is hidden during a drag, which scrolls the list from those same edges, and a drag that moves rows around the playing one does not count as the song changing. Rows are a fixed 48 px, so the row's offset is its position times that, with no measuring.
