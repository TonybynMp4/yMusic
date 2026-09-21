# YTBM: a native YouTube Music player

## Context

Greenfield build, empty repo. Goal: a YouTube Music player that feels native on Windows and Linux and stays in the TypeScript world.

Constraints the user set:

- React and TypeScript. No Electron, no Flutter, no being stuck in C#.
- Windows and Linux are both first-class targets, shipped together. Mobile later.
- Playback should use libmpv.
- Preferred libs: Tauri, tRPC, shadcn/ui, better-auth, zod. (tRPC was evaluated and dropped — see below. The rest all earn their place.)

Two facts from research shape the design:

1. There is no official YouTube Music API. The workable path is `youtubei.js` (LuanRT), a pure-TypeScript client for YouTube's internal InnerTube API with a dedicated `YTMUSIC` client. It covers search, browse, library, playlists, and stream resolution.
2. YouTube Music Premium's offline downloads are DRM-locked, app-managed encrypted blobs. They cannot be extracted or replicated. What *is* achievable is resolving the premium-quality audio stream (256k AAC, or opus itag 774, when signed into Premium) and saving it to a local file ourselves. So "offline" and "download to local files" are one mechanism, built once.

## Architecture

**Tauri 2** shell: a Rust core plus a React/TypeScript frontend rendered by the system webview (WebView2 on Windows, WebKitGTK on Linux). Binary is a few MB, memory stays low, and the same Rust and TypeScript run on both targets.

The honest tradeoff versus the earlier `react-native-windows` idea: Tauri does **not** give real WinUI controls. The UI is HTML in a webview. We buy that back with platform integration rather than platform widgets, per target:

| | Windows | Linux |
|---|---|---|
| Webview | WebView2 (evergreen, bootstrapper in installer) | WebKitGTK 4.1 |
| Window chrome | Custom titlebar with real snap-layout hit-testing, Mica via `window-vibrancy` | Custom titlebar as CSD; no vibrancy, flat themed surface |
| Theme | System accent color, light/dark, Segoe UI Variable | `org.freedesktop.appearance` color-scheme and accent via XDG portal, system UI font |
| Media controls | SMTC — volume flyout and media keys | MPRIS — GNOME/KDE media widgets and media keys |
| Secrets | Windows Credential Manager | Secret Service (gnome-keyring / KWallet) |
| Deep link | `ytbm://` registered by the installer | `ytbm://` via a `.desktop` file with `MimeType=x-scheme-handler/ytbm` |

`souvlaki` covers SMTC and MPRIS behind one API, and `keyring-rs` covers Credential Manager and Secret Service behind another, so both rows are one code path with two backends rather than two implementations. The keyring holds only a random key; the session itself is sealed with it (ChaCha20-Poly1305) in the app data directory, because Credential Manager caps a secret at 2560 bytes and a Google cookie header runs close to that. On a Linux machine with no running Secret Service, sign-in still succeeds for the session and the failure to persist is logged.

Tauri also removes the hidden-webview contortion from the previous plan. The frontend *is* a Chromium DOM, so `youtubei.js` and BotGuard both run in-process. Two details make it work:

- **CORS.** InnerTube rejects browser-origin requests. `youtubei.js` accepts a custom `fetch`; we hand it `tauri-plugin-http`'s fetch, which performs the request in Rust and bypasses CORS entirely while letting us control headers and cookies.
- **PO tokens.** Minted at runtime by Google's BotGuard VM, which needs a real DOM and `eval` — so neither the worker (no DOM) nor the app's page (strict CSP, and IPC next to Google's code). It runs in a hidden iframe on its own `botguard:` scheme, served by Rust from `packages/youtube/botguard/` with a CSP allowing eval and nothing else, reached only over a MessagePort. The worker does all the networking (challenge, integrity token) and runs the minted flow; the frame only runs the VM. Tauri counts custom schemes as local origins, so what keeps the frame off the IPC is that Tauri's init scripts, with the per-run invoke key, reach the main frame only — the frame reports this on every load. `VISIONOS` (no token, no evaluator) stays the first choice; the PO-token path is the fallback.

Audio plays through **libmpv in Rust** (`libmpv2` crate), driven by Tauri commands, with state and position pushed back to the frontend over a Tauri `Channel`. On Linux we link the system `libmpv` and declare it as a package dependency; on Windows we ship `libmpv-2.dll` beside the binary. Same Rust, different linking — keep the mpv version floor explicit so a distro's older libmpv fails at startup with a real message instead of a missing symbol. The engine resolves an audio-only stream URL and hands it to mpv, which streams it directly over HTTP range requests — no local proxy. Playing the raw audio-only stream is also what makes playback ad-free: the ads live in the web player, not in the stream.

Two mpv details that will otherwise cost a day each: googlevideo binds the stream to the requesting session, so mpv must be given the same `User-Agent`, cookies, and PO token via `http-header-fields` that resolved the URL; and stream URLs expire in roughly six hours, so the queue re-resolves a track's URL if its lease is stale before enqueueing it. Set `gapless-audio=yes` and prefetch the next queue item for seamless transitions.

### Where each requested library earns its place

**zod** — the spine. InnerTube responses are undocumented and change without notice, so every response is parsed at the engine boundary into a domain model; a schema failure becomes a legible error instead of a downstream `undefined`. Also used for worker call inputs, the settings file, and every payload crossing the Rust↔TS boundary. Derive TypeScript types from the schemas, never the other way around.

**tRPC — dropped.** It was in the original preferred-libs list, and the case for it was the one real boundary in the app: the data engine runs in a **Web Worker**, not on the UI thread, so that `youtubei.js` parsing and BotGuard attestation (genuinely slow and bursty) stay off the render thread. That boundary is real and still stands. tRPC is simply the wrong tool for it.

  tRPC exists to recover types that were lost crossing a *network*, where the two sides are separately compiled and the wire is untyped JSON. Our two sides are in one repo, compiled together by one `tsgo` invocation — the types were never lost, so there is nothing to recover. What remains is a router, a procedure builder, a hand-written `MessageChannel` link, and a codec, all to arrive back at the type the worker already exported. Two things do the job with no ceremony:

  - **Comlink** for the worker. It proxies the exported object across `MessageChannel` and keeps its type, so a worker method is called like a method and is typed like one. It is also the same primitive the plugin sandbox needs, so the app grows one worker-RPC mechanism rather than two.
  - **tauri-specta** for Rust. It generates TypeScript bindings from the command signatures, which beats both tRPC and a hand-written wrapper: those describe what we *believe* Rust returns, whereas generated bindings cannot drift from what it actually returns. `packages/ipc` keeps the zod parsing for InnerTube-shaped payloads, where the schema is a guess about someone else's API and validation earns its keep.

  **TanStack Query stays**, used directly. Caching, deduping, and infinite scroll for search and browse were most of the reason to want tRPC, and none of them needed tRPC to work.

  tRPC does come back for **plugin backends** (see Plugins), where there is a real process boundary between two separately running sides. It stays out of the core.

**shadcn/ui** — the UI layer, with Tailwind v4. Owned source rather than a dependency, which matters because a music player needs heavily customized sliders, context menus, and virtualized lists. Theme tokens are driven from the Windows accent color and light/dark setting read via Tauri.

**better-auth** — worth being precise about, because it does not fit the YouTube login. OAuth is not available either: InnerTube only takes OAuth tokens from YouTube's own TV client, whose flow is a device code with no redirect to catch, and whose tokens YouTube began refusing in late 2024 (yt-dlp dropped it for that reason). So sign-in is a cookie session, like every working third-party client: Google's own sign-in page opens in an incognito app window with no IPC capability, and once it lands on `music.youtube.com` the window's cookies are read back, sealed, and handed to the engine worker. youtubei.js derives the `SAPISIDHASH` authorization from them. Only the browsing client is signed in; the VISIONOS player client stays anonymous, since a web cookie on a non-web client is the mismatch YouTube flags. No auth framework in that path.

  better-auth belongs to the **optional sync service** (`services/sync`): a small Hono server that owns YTBM accounts so settings, local-library metadata, download state, and play history can follow the user to a second desktop or to mobile. That is a post-MVP phase, and the desktop app works fully without it. Building it there rather than bolting sessions onto the local app is the difference between using better-auth and misusing it.

## Monorepo layout

pnpm workspaces plus Turborepo. `tsgo` (TypeScript 7 native compiler) for workspace type-checking; Vite for the app bundle.

- `packages/core` — pure TypeScript, no Tauri and no DOM. Domain models and zod schemas, the playback queue and transport state machine, the `PlaybackEngine` interface, and the auth token-store interface. Framework-agnostic so mobile can reuse it verbatim.
- `packages/youtube` — the data engine, run in a Web Worker. The `youtubei.js` wrapper (search, browse, library, playlists, `getStreamingData`), the `bgutils-js` PO-token provider, and the Comlink-exposed engine API, split into `worker` and `host` entry points so the main bundle never imports youtubei.js. Workers have no Tauri IPC, so the worker's `fetch` is serialised back to the host and sent through `tauri-plugin-http` there. No React, no direct Tauri window APIs.
- `packages/ipc` — typed, zod-validated wrappers over Tauri commands and event channels. The only file in the repo that calls `invoke`.
- `packages/ui` — shadcn components, theme tokens, and the player-specific primitives (seek bar, volume, queue row, marquee title).
- `apps/desktop` — the Tauri app. `src/` is the React frontend; `src-tauri/` is the Rust core: mpv playback, the sealed account session and its sign-in window, downloads, local-library indexing, media controls (`souvlaki`), single-instance, tray, and updater. Platform differences live in a `platform/` module with one trait per concern, not in `#[cfg]`s scattered through feature code.
- `services/sync` — post-MVP. Hono plus better-auth plus Drizzle/SQLite.

## MVP (Windows and Linux)

Target: sign in, search, play a track, control playback and the queue — on both platforms, from the same commit. Develop on whichever machine is in front of you, but run the other before calling a step done; catching a WebKitGTK or Secret Service divergence a week late costs far more than the fifteen minutes it takes to check.

In build order:

1. Scaffold the pnpm/Turborepo workspace and the Tauri 2 app with React, Vite, Tailwind v4, and shadcn/ui. Empty window building and running on both targets, custom titlebar in place, Mica on Windows and the themed fallback on Linux.
2. libmpv in Rust. Commands for load, play, pause, seek, and volume; a `Channel` emitting position and state. Prove it against a plain HTTPS audio URL before any YouTube code exists, on both platforms — this is where the bundled-versus-system linking split gets settled.
3. The data-engine worker. `youtubei.js` over `tauri-plugin-http` fetch (proxied through the main thread), the engine API exposed over Comlink, zod schemas for the response shapes, and `search` plus `getStreamingData` working end to end.
4. Sign-in: Google's page in an incognito app window, the resulting cookie session sealed with a keyring-held key, and the account shown in the corner. (Originally OAuth with a `ytbm://` deep link; see the better-auth note for why that cannot work.)
5. ~~The PO-token fallback.~~ Done. `VISIONOS` first; on failure — or when mpv is refused a stream it resolved — `TV_SIMPLY` with a session token bound to a fresh visitor id and a content token bound to the video. Measured: `TV_SIMPLY` streams answer 403 without a token and 206 with one; its formats are signature-ciphered, so the worker installs a `new Function` evaluator (worker scripts carry no CSP). BotGuard's challenge is bound to the `Origin` it was requested from: none and `tauri://localhost` pass, YouTube's own origins and the dev server's are refused, so those requests go out with none. The network test runs the frame's own `frame.js` in jsdom and asserts 206 with the token, 403 without.
6. UI: search screen, now-playing bar, queue view. Wire `packages/core`'s queue and transport to the mpv commands. `souvlaki` for SMTC and MPRIS so media keys work on both.
7. Packaging and updates. Windows: MSI/NSIS with the WebView2 bootstrapper, updated by `tauri-plugin-updater` directly. Linux: a `.deb` attached to a GitHub release — no AppImage, no hosted apt repo.

    The t3code mirror already proves this shape in production, so copy it rather than rediscovering it. Its Linux workflow builds `.deb` and `.rpm` from upstream tags and publishes them to the fork's own releases, and a patch (`0001-linux-deb-rpm-auto-update`) makes those installs updatable in place. The mechanism is exactly the one to reproduce: download the new package, apply it with `pkexec dpkg -i`, relaunch. One password prompt, the same way Windows prompts through UAC, and dpkg stays authoritative over `/usr`.

    The one thing that does not carry over is the plumbing. electron-updater ships `DebUpdater`/`RpmUpdater` for free; `tauri-plugin-updater` has no `.deb` target at all, so on Linux we use it only for the version check against the release's `latest.json` and write the download-and-install step ourselves. Four details the mirror learned the hard way are worth taking as given:

    - **Record the install flavor at build time.** electron-builder writes a `package-type` resource that electron-updater reads back to decide which updater to construct; the mirror's patch works by trusting that same marker. We need our own equivalent — a build-time constant saying "installed from the `.deb`" — so a hand-run binary or a future Flatpak gets "a new version is available" with a link instead of a broken upgrade button.
    - **No `pkexec` means no auto-update.** Detect it and say so plainly, pointing at manual reinstall, rather than failing mid-install.
    - **Log the updater's error cause.** The mirror needed a whole patch (`0005`) for this because update failures are otherwise opaque. Build it in from the start.
    - **`.deb` needs package metadata AppImage never asked for** — maintainer, section, dependencies, and an AppStream metainfo file so GNOME Software and Discover describe the app instead of showing a bare binary. That is mirror patches `0002` and `0003`, and it is real work, not a checkbox.

    Sign the release assets with the updater's minisign key so the download is verified before it is handed to dpkg.

    One thing gets *easier* than the mirror's experience: its `.desktop` deep-link handling is convoluted because an AppImage's `process.execPath` points into a transient `/tmp/.mount_*` directory. A `.deb` installs a stable exec path and its own `.desktop` file, so a `ytbm://` handler, if one is ever needed, is straightforward by comparison.

## Roadmap after MVP

- Library and playlists via `youtubei.js`.
- Downloads to local files — the premium stream saved to disk, written in Rust with resumable range requests. This is the real "offline." Respect XDG base directories on Linux and the known-folder paths on Windows.
- Local music library. Index on-disk files in Rust, play through the same mpv layer behind `PlaybackEngine`.
- Flatpak, after the `.deb` is solid — it needs portal-based file access and a bundled libmpv, and it brings its own update mechanism, which is why it comes second rather than instead. An apt repo is worth revisiting only if other people start installing this; for one user, a release asset is the whole story.
- Sync service with better-auth, once there is a second device to sync to.
- **Linking local files to YouTube tracks.** One `links` table mapping a `local:` id to a `yt:` id, so a downloaded track plays from disk while keeping the catalogue APIs — artist pages, radio, plugin panels — pointed at the YouTube side. Identification comes in three grades, and the grade is stored alongside the link rather than being inferred later:
  - *Exact, from tags.* yt-dlp's `--embed-metadata` writes the source URL into `PURL`, and ripped libraries often carry `MusicBrainzRecordingId`. Both are unambiguous and free; the scanner reads neither today and should.
  - *Matched.* Title, artist and album normalised, with `duration_ms` as the discriminator — it is the one field that is objective, already indexed, and hard to fake agreement on. Below a confidence floor, leave it unlinked rather than guessing.
  - *Manual.* The user corrects a match, and the correction outranks any later rescan.

  The bulk identification pass is a separate pass from the filesystem scan: that one is local and fast, this one is network-bound and rate-limited, so it runs in the background, resumably, and a library with no links is fully functional without it.
- Mobile via Tauri 2's iOS/Android targets, reusing `packages/core` and `packages/youtube`. libmpv is heavy on iOS, so expect a platform player behind the `PlaybackEngine` interface — which is why that interface exists.

## Plugins

Pear Desktop is the reference, and the lesson from its source is what *not* to copy: its plugins are compiled into the app at build time (`virtual:plugins`) and run with full Electron access, so there is no sandbox and no permission model — a plugin is trusted because it shipped in the binary. YTBM plugins are loaded at runtime, so they need both.

- **Written in TypeScript, never Rust.** `@ytbm/plugin-sdk` is the whole authoring surface. Each plugin runs in its own Web Worker and talks to the app over Comlink — the same mechanism as the data engine, so there is one worker-RPC path in the app, not two.
- **Capabilities are declared, not discovered.** The plugin definition carries a `capabilities` array (`network:<host>`, `library:read`, `playback:control`, `fs:write:<dir>` …), shown to the user on install and enforced at the worker boundary: an undeclared call does not exist on the proxy the plugin receives. The worker is what makes the enforcement real rather than advisory.
- **Contributions go into typed slots.** `player.panel` (a tab in the expanded player, beside Up next — already built as `PlayerPanelTab`), `artist.section` (a block on the artist page), `home.shelf` (a row on the home page). One plugin can fill several: trivia and tour dates belong both beside the current song and on the artist page.
- **Some plugins need a backend process.** A worker can't spawn `yt-dlp`, hold a socket open after the window closes, or serve a "now playing" endpoint to OBS or a stream overlay (Pear ships exactly that as its API-server plugin). Those plugins get a sidecar, and the plugin's UI half talks to its backend half over **tRPC** — a real process boundary, two runtimes, input that has to be validated on arrival, and subscriptions for progress and events. The SDK makes it the blessed pattern: the backend exports a router, the UI half gets a client typed from it.

  The sidecar runs on **Deno**, because a Node or Bun process would escape the capability model entirely: it has the whole filesystem and network. Deno's permission flags map almost one-to-one onto the declared capabilities — `network:<host>` becomes `--allow-net=<host>`, `fs:write:<dir>` becomes `--allow-write=<dir>`, and running `yt-dlp` becomes `--allow-run=yt-dlp` — so enforcement is the runtime's job, not ours. The cost is binary size, so the runtime is downloaded the first time a backend plugin is installed rather than shipped with the app. Transport is stdio by default; a plugin that exists to serve other programs, like the API server, declares `server:listen:<port>` and binds to `127.0.0.1` with a per-session token.
- **Some plugins transform rather than render.** A `tracks.transform` hook receives a list — search results, radio, recommendations — and returns it reordered or filtered. No UI slot involved.

Ideas so far:

- **Lyrics** — synced where the provider has timings, plain otherwise. `player.panel`.
- **Trivia** — facts about the current song and artist. `player.panel`, `artist.section`.
- **Tour dates (Bandsintown)** — upcoming shows for the artist. `player.panel`, `artist.section`, `home.shelf` for artists you listen to.
- **Downloader** — a backend plugin. Saves the stream to disk and writes the video ID into the file's tags, so the local↔YouTube link above is exact from the start.
- **Duplicate collapsing** — bands release a song as a single and again on the album, and YouTube Music treats them as two tracks, so both get suggested. This plugin keeps one per song via `tracks.transform`, preferring the album version. The hard part is not merging what should stay apart: live, acoustic, remix and remaster are genuinely different recordings, and they usually differ in a title suffix or in duration by more than a second or two — the same signals, and the same matcher, as linking local files to YouTube, so it gets written once and shared. A strong example of a minimal grant, too: it needs the list it is handed and nothing else — no network, no library access.

## Risks

- **PO-token and BotGuard fragility.** Breaks whenever Google changes BotGuard. Isolated in the data engine so fixes stay in one place; client impersonation reduces how often we depend on it at all.
- **Stream-session binding.** Header, cookie, and token mismatch between the resolving fetch and mpv produces 403s that look like bugs elsewhere. Keep resolution and playback handoff in one code path.
- **WebView2 is not WinUI.** Accepted deliberately, mitigated by the platform integration listed above. If native controls later prove essential, `packages/core` and `packages/youtube` port to a `react-native-windows` shell without rewriting the engine.
- **WebKitGTK is the weaker of the two webviews**, and it is the one carrying BotGuard. It lags Chromium on JS features and performance, needs `WEBKIT_DISABLE_DMABUF_RENDERER=1` on several driver and compositor combinations to avoid a blank window, and is fingerprinted differently by Google. Expect the PO-token path to degrade on Linux before it degrades on Windows — another argument for treating JS-less client impersonation as the default path rather than an optimization.
- **Linux distribution fragmentation.** libmpv version skew, a missing Secret Service, and WebKitGTK 4.0 versus 4.1 are the three that will actually bite. Pin the floor versions, detect at startup, and fail with a message that names the missing piece.
- **The worker boundary is load-bearing; the RPC library is not.** If the data engine ever collapses back onto the main thread, Comlink goes with it and the engine is called directly. Nothing above it should be able to tell the difference, which is the property worth protecting.
- **Terms of service.** Personal and educational build. Downloading commercial music can violate YouTube's terms; the user owns that call.

## Reference projects

- `LuanRT/YouTube.js` (`youtubei.js`) — the InnerTube data layer.
- `LuanRT/BgUtils` (`bgutils-js`) — PO-token and BotGuard attestation.
- limusic (Tauri, Rust, libmpv) — closest prior art for the playback path and client impersonation.
- Kodama (Tauri 2, React) — closest prior art for the app shell.
- `souvlaki` — cross-platform media-transport controls (SMTC on Windows).

## Verification

- MVP end to end, run on Windows and on Linux: `pnpm tauri dev`, sign into a YouTube Music account, search a known track, confirm playback, seek, and queue. Log the resolved itag to confirm the premium format when signed into Premium.
- Unit-test the `packages/core` queue and transport logic and the zod schemas against recorded InnerTube fixtures, in plain TypeScript with no Tauri. Run `tsgo` across the workspace.
- PO-token path: force the web client to confirm the minting path works, then disable minting to confirm the JS-less fallback keeps playing.
- Native feel, per platform: on Windows, media keys and the volume flyout drive playback, the window shows Mica and correct snap layouts, and the app survives a WebView2 runtime update. On Linux, the GNOME/KDE media widget shows the current track and its controls work, the titlebar matches the desktop theme in light and dark, and sign-in still succeeds with the keyring locked.
- Install the built `.deb` in a clean `debian:13` container in CI and assert the installed file list with `dpkg -L`, the way the t3code mirror gates its Linux releases. This catches missing runtime dependencies that a dev machine hides.
- Cut a bumped draft release and confirm the in-app updater sees it, verifies the signature, installs through `pkexec dpkg -i`, relaunches, and leaves `dpkg` state consistent. Then run the same check on a desktop with no `pkexec` and confirm it degrades to a clear manual-reinstall message.
