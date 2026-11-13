# Playback

**libmpv in Rust** (`libmpv2`), driven by Tauri commands, with state and position pushed to the frontend over a Tauri `Channel`. Linux links the system `libmpv` and declares it as a package dependency; Windows ships `libmpv-2.dll` beside the binary.

The floor is mpv 0.35, the first release with `libmpv.so.2`. The binary imports ten libmpv functions, all present since client API 2.0, so the library name is the whole requirement. The `.deb` depends on `libmpv2 (>= 0.35)`, and a hand-run binary on an older system stops in the dynamic loader before any of our code runs. If mpv itself fails to start, the app hides its window, shows an error dialog naming the package, and quits when it is closed. The startup log records the loaded version (`playing through mpv v0.41.0`).

The engine resolves an audio-only stream URL and mpv streams it over HTTP range requests, with no local proxy. The raw audio stream has no ads: those live in the web player.

Two details that each cost a day if missed:

- The lease's `headers` go to mpv through `http-header-fields`. YouTube's leases carry none: every URL the player clients below hand out plays for any client that asks, and gapless depends on that (see below).
- Stream URLs expire after about six hours, so the player re-resolves a track whose lease is stale.

## Player clients

A song's stream is resolved through one InnerTube player client after another, until one serves it. Anything short of YouTube saying the video is gone moves on to the next. The log records each resolution (`resolved <id> as itag 774 through WEB_REMIX`).

- Signed in: `WEB_REMIX`, then `VISIONOS`, then `TV_SIMPLY`.
- Signed out: `VISIONOS`, then `TV_SIMPLY`.

`WEB_REMIX` is music.youtube.com's own client, with the session cookie and the player script's signature timestamp. It is the only client that hands out Premium's formats (itag 774, Opus, and 141, AAC, both about 256 kbps) as plain URLs. Its formats are ciphered, signature and `n` both, and the URLs need both deciphered (the signature alone gets a 403), with the same evaluator `TV_SIMPLY` uses (see [The player script](#the-player-script)). Once deciphered they need no cookie and no PO token. `VISIONOS` needs no token and no evaluator. `TV_SIMPLY` needs a PO token bound to its visitor id, and is there for when `VISIONOS` stops working. A web cookie on either of those gets HTTP 400, so they stay anonymous.

When mpv refuses a stream that resolved (a 403 shows up only in mpv), the player retries it once, starting on the client after the one that resolved it.

On "high", a Premium format wins whenever one is offered, Opus before AAC, then the highest bitrate. "normal" and "low" pick by bitrate as before. There is no level above "high": 256 kbps is the most YouTube serves.

**Degraded.** A song is degraded when a signed-in account on "high" gets less than its best because `WEB_REMIX` did not serve it: anything but a Premium format for a Premium account, anything below Opus 251 for a free one. A badge (a Tabler warning icon) sits beside the title in the player bar and the full player, with the reason in its tooltip. Whether the account has Premium comes from `IS_SUBSCRIBER` in music.youtube.com's page config, fetched once per sign-in and only when a fallback needs judging, or from a `WEB_REMIX` lease that was a Premium format. "normal" and "low" pick the same formats on every client, so a fallback there is never degraded. Stats for nerds shows each YouTube song's itag and player client.

### The player script

`WEB_REMIX` and `TV_SIMPLY` decipher with YouTube's player script (`base.js`, about 2.6 MB). `VISIONOS` URLs carry nothing to decipher, so it never needs the script (`memory.md`). youtubei.js parses the script to pull out the `n` and signature transforms, about 180 KB of source, and keeps only that. The parse is the expensive part: it takes the heap to about 200 MB, and the process keeps that as resident memory after the syntax tree is collected (in Node, 120 MB resident without the script and 344 MB with it, of which 18 MB is live heap).

So the engine worker never parses it. It reads the current player id from the iframe API and asks the main thread for the analysed script. The main thread downloads `base.js`, hands it to a worker started for the job (`player-script.worker.ts`), and ends that worker once it has the result, which takes the memory with it. The result is plain data and is kept in `localStorage` under the player id and the youtubei.js version, so the next launch on the same script skips the download and the parse. YouTube moves to a new script every week or so.

`WEB_REMIX` and `TV_SIMPLY` each get their own youtubei.js `Player` over the one analysed script, since only `TV_SIMPLY`'s carries a PO token. The engine asks for the script the first time one of them is needed, and once for its life: on the first song when signed in, and only on a fallback when signed out. Outside the app (tests, Node), the engine analyses it in place.

SABR would not avoid this: its streaming URL carries an `n` too, deciphered with the same script.

### Why not SABR

YouTube's own web players mostly stream over SABR, a protocol of UMP-framed segments over POSTs, and the `TVHTML5` client offers 774 and 141 that way signed in. music.youtube.com doesn't use it. A HAR of the site playing a Premium song (2026-10-12) shows `/player` answering `useServerDrivenAbr: false` and 141 fetched from its deciphered format URL. The site's media requests are POSTs with `range`, `ump=1` and a `pot` in the query, but mpv's plain range GET without them answers 206 too. SABR on `WEB_REMIX` signed in is refused for Premium formats: the first response asks for a player reload, and after it, `sabr.no_audio_selected`. That happened on googlevideo 4.1.1 and on its main branch's SabrStream rewrite alike, with every request change yt-dlp's SABR branch makes.

If `WEB_REMIX` ever stops handing out URLs, the way back is `TVHTML5` plus SABR. What was measured, with googlevideo's main branch (`01d5b091a6`, applied as a pnpm patch over 4.1.1's `dist/` until a release has it):

- A signed-in `TVHTML5` `/player` call with the web cookie and the signature timestamp returns `serverAbrStreamingUrl` and the ustreamer config. The streaming URL carries an `n` to decipher. Signed out, the TV client answers "The page needs to be reloaded".
- `SabrStream` with that URL, the config, `clientInfo` of `TVHTML5` and its version, the adaptive formats (with `isVb` read from `xtags`: a base64url protobuf, where the pair `vb=1` marks voice boost), `EnabledTrackTypes.AUDIO_ONLY` and the chosen itag downloads a whole song in under 10 s. No GVS PO token and no cookie on the media requests were needed.
- The server can ask for a fresh `/player` response mid-stream; answer `onReloadPlayerResponse` with a call carrying its token.
- mpv can't speak SABR, so this needs a local SABR-to-HTTP proxy in front of it.

Prior art: googlevideo#42 and #54 (the reload loop on voice-boost formats, and the rewrite that fixed it), yt-dlp#13515 (coletdjnz's SABR downloader), and NotArandomGUY/browser-utils for the protos as YouTube's web player defines them.

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
- On quit, a change still settling is saved before the app exits.

The queue, in the full player's Up next tab, keeps the playing song in view. Opening it centres that row before the first paint. When the song changes and the new row is out of view, the list scrolls to it, unless the old row was out of view too: then you had scrolled away to read the list, and it stays where you left it. While the playing row is hidden, a "Now playing" button at the top or bottom edge, on the side where the row is, scrolls back to it. The button is hidden during a drag, which scrolls the list from those same edges, and a drag that moves rows around the playing one does not count as the song changing. Rows are a fixed 48 px, so the row's offset is its position times that, with no measuring.

Above the queue, "Playing from" names what it plays: the playlist, album or artist it was started from, or for a resumed queue, the name the account gives it (the subtitle of the `GET_QUEUE` answer's queue header). A song radio, a mix or local files have no name, and nothing shows. The name belongs to the queue, so it goes when the queue is replaced or cleared, and it is saved with it.

A queue picked up from another device gets a `devices-share` icon after the name, and the same icon in the player bar, after the song's title. Hovering it gives the account's own sentence for where the queue was left ("From your Android device"), which the answer carries in `musicQueueConfig.musicQueueRestorationInfo`. It is only read when `isCrossDeviceQueue` is set. The icon marks where the queue came from, not where it plays, which is why it is a share glyph and not a bare device.

## Shuffle

Shuffle happens in the queue reducer (`packages/core/src/queue.ts`), not on YouTube's servers. Turning it on keeps the playing song first and shuffles the rest with Fisher-Yates. A playlist still loading shuffles each later page in among the songs still to come, each at a uniformly random place, so the songs already up next keep their order and none lands before the playing one.

**Fewer repeats**, on by default, makes songs played recently on this device tend to come later. It is still a random order, not a sort: each song gets the key `-ln(u) / weight` for a uniform `u`, and the order is the keys ascending (Efraimidis and Spirakis). The weight is 1 for a song never played and `1 - 0.95 * exp(-age / 7 days)` otherwise: 0.05 just after it played, about 0.65 a week on and 0.99 after a month. Late pages get the same treatment in `weightedInsert`: the songs still to come have no keys, so a fresh set is drawn for them and handed out in sorted order to the places they hold, and each new song goes where its own key falls. With equal weights this reduces to the uniform splice above. The weighting lives in `packages/core/src/fewer-repeats.ts`.

The reducer stays pure. `usePlayer` adds a `weight` function, read from the play history as of that moment, to the actions that shuffle (`setQueue`, `extend`, `setShuffle`) when the setting is on, and the tests in `queue.test.ts` drive it with a seeded `rng`. Changing the setting does not reshuffle the queue; it applies from the next shuffle.

**The play history.** `usePlayHistory` records the time a track starts playing, keyed by track id (`yt:<video id>` for YouTube, so local files count too), and saves it to `play-history.json` beside `queue.json` (see [The queue across restarts](engine.md#the-queue-across-restarts)). It records whatever the setting, so turning it on works straight away, and under "Pause watch history" too, since it never leaves the device. Entries older than 60 days are dropped, by which time their weight is within 0.01 of never played, and at most the newest 5000 are kept.

