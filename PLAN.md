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
  - Like and dislike songs (`like/like`, `like/dislike`), with a setting to skip disliked songs when they come up in the queue.
  - A button to dismiss the whole queue.
  - A song credits dialog, from a song's menu and from an album's when YouTube has credits for it.
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

- **Lyrics**, synced where the provider has timings. `player.panel`.
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
