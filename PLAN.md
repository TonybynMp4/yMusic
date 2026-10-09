# yMusic: a native YouTube Music player

This file is what is planned and why. What is built is documented in [docs/](docs/README.md), and [PROGRESS.md](PROGRESS.md) tracks both.

## Goal and constraints

A YouTube Music player that feels native on Windows and Linux and stays in the TypeScript world.

- React and TypeScript. No Electron, no Flutter, no C#.
- Windows and Linux are both first-class targets, shipped together. Mobile later.
- Playback uses libmpv.
- Preferred libs: Tauri, tRPC, shadcn/ui, zod.
- Layout and behaviour follow YouTube Music, not Spotify.

Two facts shape the design:

1. YouTube Music has no official API. The workable path is `youtubei.js` (LuanRT), a TypeScript client for YouTube's internal InnerTube API with a dedicated `YTMUSIC` client. It covers search, browse, library, playlists and stream resolution.
2. Premium's offline downloads are DRM-locked blobs that cannot be extracted. What we can do is resolve the premium-quality stream (256k AAC, or opus itag 774 when signed into Premium) and save it ourselves. So "offline" and "download to local files" are one feature, built once.

## Packaging and updates

This comes after the MVP. Until then a release carries the plain `.deb` Tauri builds, with no updater.

Windows: MSI/NSIS with the WebView2 bootstrapper, updated by `tauri-plugin-updater`. Linux: a `.deb` attached to a GitHub release, updated in the app. No AppImage, no hosted apt repo.

The t3code mirror (`/home/tony/code/t3code/mirror-fixes`) already does this in production, so copy it. Its Linux workflow builds `.deb` and `.rpm` and publishes them to the fork's releases, and its patch `0001-linux-deb-rpm-auto-update` updates those installs in place: download the new package, apply it with `pkexec dpkg -i`, relaunch. One password prompt, like UAC on Windows, and dpkg stays in charge of `/usr`.

`tauri-plugin-updater` has no `.deb` target, so on Linux it only checks `latest.json` and we write the download and install ourselves. Lessons from the mirror to take as given:

- Record the install flavour at build time (`YMUSIC_INSTALL_FLAVOR`, already read in `platform/mod.rs`). A hand-run binary or a future Flatpak then gets "a new version is available" with a link, not a broken upgrade button.
- No `pkexec` means no auto-update. Detect it and point at a manual reinstall instead of failing halfway.
- Log the updater's error cause. The mirror needed a whole patch (`0005`) for this.
- A `.deb` needs real package metadata: maintainer, section, dependencies, and an AppStream metainfo file so GNOME Software and Discover can describe the app (mirror patches `0002` and `0003`).

Sign release assets with the updater's minisign key so the download is verified before dpkg sees it.

## Next

- **Player tabs.** The full player's side panel gets YouTube Music's tabs (Up next, Lyrics, Related, Comments) and one of the app's own, Details, which comes first and is open by default. Up next is the queue as it is today. Each tab loads when first opened, and stays loaded for the song.
  - *Details* is a deliberate exception to following YouTube Music: YouTube Music has no such tab, and this one takes after the page Spotify scrolls to under its player. It is built from what YouTube has: the song's title, artists, album and year; the album's art, type, year and track count, which opens the album; each artist's picture, subscriber count and the start of their description, which opens the artist; and the song's credits when YouTube has them (the same data as the planned credits dialog). For a local song it shows the tags, the file's path, codec and bitrate.
  - *Lyrics* are YouTube's own, from the `MPLY` browse id the `/next` response names, with timings when YouTube has them so the current line follows playback. A song with none says so. Timings need research: the web client (`WEB_REMIX`) seems to return plain text only, and ytmusicapi switches to the Android music client for timed lyrics, so that one call may need a different client from the rest of the engine. Other providers stay a plugin idea.
  - *Related* is YouTube Music's tab: the shelves from the related browse id in `/next`, as cards that play or open like anywhere else.
  - *Comments* are the comments on the song's video, which YouTube Music shows for songs with one. Read only at first: top comments, with replies collapsed. Hidden for local songs and songs without a video.
- **Library page.** One page for everything saved, as YouTube Music's Library is: chips for Playlists, Songs, Albums, Artists and Local files, a sort (recently added, recently played, A to Z) and a grid or list toggle. Signed out, it shows the local files and folders. The sidebar stays the quick list; "Library" in it opens this page.
- **Playlist art, details and editing.** A playlist's page shows its owner, privacy, song count, total length and description. The owner can rename it, change the description and privacy, remove songs, reorder them by dragging, and delete it, through InnerTube's `browse/edit_playlist` actions and `playlist/delete`, which is what YouTube Music's web player sends. A custom cover upload comes last: YouTube Music supports it, but the upload flow needs research.
- **The queue across restarts.** The queue, the song in it and the position are saved locally whenever they change, and come back at launch, paused, the way a resumed queue does now. Along with it, the device saves what it last wrote to the account's server queue: the playlist or radio it named and the selected song. At launch it fetches the server queue. If that still matches what this device wrote, nothing has played elsewhere since, so the local copy comes back exactly, position included. If it differs, another device has moved on, and the server queue wins, as Resume does today. Signed in but offline, signed out, or when the server queue comes back empty (a free account may get nothing, see Resume in `docs/engine.md`), the local queue comes back unchecked.
- **Volume across restarts.** Every launch starts at full volume today. Rust saves the volume, and whether it is muted, beside the settings file whenever mpv reports a change, so a change from the OS media controls counts too. Writes wait until the slider settles rather than following a drag. At launch Rust sets mpv's volume before anything loads, and the player bar starts from that value instead of 1. The value saved is the linear slider fraction, as now (see Volume in `docs/playback.md`).
- **Search history.** Recent searches show under the empty search box, each with a button to remove it. Signed-in searches already reach the account's history; the existing *Pause search history* setting keeps them out by searching through a cookieless client. That switch becomes one "Search history" choice with three options:
  - *YouTube*, the default when signed in and today's behaviour: searches are recorded on the account, and the list is the account's own. YouTube Music returns it from the search suggestions request with an empty query, and removing one sends the entry's feedback token.
  - *On this device*: a local list, with searches kept off the account through the cookieless client. Like the current pause, its description says results aren't personalised.
  - *Off*: nothing recorded anywhere, the current pause.

  A saved `pauseSearchHistory` of true becomes *Off*, and false becomes *YouTube*, so nobody's search changes on update. Signed out there is no account to record on, so the list is local and *YouTube* is unavailable.

## Later

- **Faster loading.** Cache playlist, album and artist pages in SQLite, show the cached copy at once and refresh in the background.
- **Downloads.** The premium stream saved to disk from Rust, with resumable range requests. XDG directories on Linux, known folders on Windows.
- **Linking local files to YouTube tracks.** One `links` table mapping a `local:` id to a `yt:` id, so a downloaded track plays from disk while artist pages, radio and plugin panels still point at YouTube. The grade of each link is stored with it:
  - *Exact, from tags.* yt-dlp's `--embed-metadata` writes the source URL into `PURL`, and ripped libraries often carry `MusicBrainzRecordingId`. The scanner reads neither yet.
  - *Matched.* Title, artist and album normalised, with duration as the tiebreaker. Below a confidence floor, leave it unlinked.
  - *Manual.* A user correction outranks any later rescan.

  Identification is its own background pass, separate from the fast filesystem scan, because it is network-bound and rate-limited. A library with no links still works fully.
- **More interactions.**
  - Pin albums, playlists and artists to a quick-access row on the home page.
  - A button to dismiss the whole queue.
  - A song credits dialog, from a song's menu and from an album's when YouTube has credits for it.
- **Crossfade.** One mpv instance can't overlap two files, so crossfade needs a second libmpv handle, with the two taking turns as the current player. The system mixer (PipeWire, PulseAudio, WASAPI) mixes their streams.
  - **The setting.** One "Crossfade" choice: Off, or 1 to 12 seconds. Off keeps gapless playback. Crossfade replaces the gapless append, because the next song plays on the other handle.
  - **The fade.** N seconds before the end, Rust loads the next track on the idle handle with its own stable volume `af`, starts it at volume 0, and ramps the two handles' `volume` in opposite directions from a timer. mpv applies the cubic curve to `volume`, so a linear ramp of the slider fraction already sounds even. The user's volume scales both handles.
  - **When it fades.** Only automatic advances fade. A skip, a picked track or Previous cuts straight to the new song, and a seek or pause during a fade ends it on the incoming song. No fade when a track is shorter than twice N, or has no known duration.
  - **What the rest of the app sees.** Position, duration, media controls and the `Advanced` event follow the incoming handle from the moment the fade starts. The output device and the 403 retry apply to whichever handle is current.
- **Theme.** Light, dark, or follow the system, on the settings page. The app is dark only today.
- **Language.** Translated UI copy, and the same language passed to youtubei.js (`lang`, sent as InnerTube's `hl`) so the text YouTube supplies, such as shelf titles, matches. Both are English today.
- **Remote control between devices**, like Spotify Connect. YouTube appears to be building its own; if the app can join that rather than invent a protocol, it should. Not researched yet.
- **Flatpak**, once the `.deb` is solid. It needs portal file access and a bundled libmpv, and brings its own updates.
- **Sync service** (`services/sync`, Hono and SQLite), once there is a second device: settings, local-library metadata, downloads and history.
- **Mobile** through Tauri 2's iOS and Android targets, reusing `packages/core` and `packages/youtube`. libmpv is heavy on iOS, so expect a platform player behind `PlaybackEngine`. That is why the interface exists.

## Plugins

Pear Desktop compiles its plugins into the app and runs them with full Electron access: no sandbox, no permissions. yMusic loads plugins at runtime, so it needs both.

- **TypeScript only.** `@ymusic/plugin-sdk` is the whole authoring surface. Each plugin runs in its own Web Worker and talks to the app over Comlink.
- **Declared capabilities.** A plugin lists what it needs (`network:<host>`, `library:read`, `playback:control`, `fs:write:<dir>`). The user sees the list on install, and an undeclared call does not exist on the proxy the plugin gets.
- **Typed slots.** `player.panel` (a tab beside Up next, already built as `PlayerPanelTab`), `artist.section`, `home.shelf`. One plugin can fill several.
- **Transforms.** A `tracks.transform` hook gets a list (search results, radio, suggestions) and returns it reordered or filtered.
- **Backends.** Some plugins need a process: running `yt-dlp`, holding a socket, serving "now playing" to OBS. Those get a sidecar, and the plugin's UI talks to it over tRPC. The sidecar runs on Deno, because its permission flags map onto the declared capabilities: `network:<host>` becomes `--allow-net=<host>`, `fs:write:<dir>` becomes `--allow-write=<dir>`. The runtime downloads with the first backend plugin rather than shipping in the app. Transport is stdio; a plugin that serves other programs declares `server:listen:<port>` and binds to `127.0.0.1` with a per-session token.

Plugin ideas:

- **More lyrics providers**, for songs YouTube has no lyrics for, synced where the provider has timings. `player.panel`.
- **Trivia** about the song and artist. `player.panel`, `artist.section`.
- **Tour dates** from Bandsintown. `player.panel`, `artist.section`, `home.shelf`.
- **Downloader.** A backend plugin that writes the video id into the file's tags, so the local-to-YouTube link is exact from the start.
- **Duplicate collapsing.** A song released as a single and again on the album shows up twice. Keep one, preferring the album version, without merging live, acoustic, remix or remaster versions. Those differ by a title suffix or by more than a second or two of duration, the same signals as local-file linking, so the matcher is shared. It needs the list it is handed and nothing else.

## Risks

- **BotGuard changes.** The PO-token path breaks whenever Google changes BotGuard. It is isolated in the engine, and `VISIONOS` keeps us off it most of the time.
- **Stream-session binding.** A header, cookie or token mismatch between resolving and playing gives 403s that look like bugs elsewhere. Resolution and the mpv handoff stay in one code path.
- **WebView2 is not WinUI.** Accepted. If native controls ever become essential, `packages/core` and `packages/youtube` move to another shell unchanged.
- **WebKitGTK is the weaker webview**, and it carries BotGuard on Linux. It lags Chromium, needs `WEBKIT_DISABLE_DMABUF_RENDERER=1` on some drivers to avoid a blank window, and Google fingerprints it differently. Expect the PO-token path to degrade on Linux first.
- **Linux fragmentation.** libmpv version skew, a missing Secret Service, and WebKitGTK 4.0 against 4.1. Pin floor versions, detect at startup, and name the missing piece in the error.
- **The worker boundary matters; Comlink does not.** If the engine ever moves back to the main thread, nothing above it should notice.
- **Terms of service.** Personal and educational use. Downloading commercial music can break YouTube's terms; that call is the user's.

## Verification

- End to end on Windows and on Linux: `pnpm tauri dev`, sign in, search a known track, play, seek, queue. Log the resolved itag to confirm the premium format when signed into Premium.
- Native feel. Windows: media keys and the volume flyout drive playback, Mica shows, snap layouts work, the app survives a WebView2 update. Linux: the GNOME/KDE media widget shows the track and its controls work, the titlebar follows light and dark, sign-in works with the keyring locked.
- Install the built `.deb` in a clean `debian:13` container in CI and check `dpkg -L`, as the t3code mirror does.
- Cut a bumped draft release and check the updater finds it, verifies the signature, installs through `pkexec dpkg -i`, relaunches, and leaves dpkg consistent. Then check a desktop without `pkexec` gets a clear manual-reinstall message.

The automated tests are described in [docs/testing.md](docs/testing.md).

## Reference projects

- `LuanRT/YouTube.js` (`youtubei.js`): the InnerTube data layer.
- `LuanRT/BgUtils` (`bgutils-js`): PO tokens and BotGuard.
- limusic (Tauri, Rust, libmpv): prior art for playback and client impersonation.
- Kodama (Tauri 2, React): prior art for the app shell.
- `souvlaki`: media controls on both platforms.
