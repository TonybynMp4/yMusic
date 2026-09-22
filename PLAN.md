# yMusic: a native YouTube Music player

This file is the design and the reasons behind it. What is built and what is left lives in [PROGRESS.md](PROGRESS.md).

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

## Architecture

**Tauri 2**: a Rust core and a React frontend in the system webview (WebView2 on Windows, WebKitGTK on Linux). The binary is a few MB and the same code runs on both targets.

The tradeoff: Tauri gives us HTML, not real WinUI controls. We make up for it with platform integration:

| | Windows | Linux |
|---|---|---|
| Webview | WebView2 (bootstrapper in the installer) | WebKitGTK 4.1 |
| Window chrome | Custom titlebar with snap-layout hit-testing, Mica via `window-vibrancy` | Custom titlebar as CSD, flat themed surface |
| Media controls | SMTC: volume flyout and media keys | MPRIS: GNOME/KDE media widgets and media keys |
| Secrets | Windows Credential Manager | Secret Service (gnome-keyring, KWallet) |

The colours are YouTube Music's own dark palette on both platforms, not the system theme, so the app reads as a companion to the service.

`souvlaki` covers SMTC and MPRIS behind one API, and `keyring` covers Credential Manager and Secret Service behind another. One code path each, two backends.

### Playback

**libmpv in Rust** (`libmpv2`), driven by Tauri commands, with state and position pushed to the frontend over a Tauri `Channel`. Linux links the system `libmpv` and declares it as a package dependency; Windows ships `libmpv-2.dll` beside the binary. The mpv version floor should be explicit, so an old distro libmpv fails at startup with a message rather than a missing symbol.

The engine resolves an audio-only stream URL and mpv streams it over HTTP range requests, with no local proxy. The raw audio stream has no ads: those live in the web player.

Two details that each cost a day if missed:

- googlevideo binds a stream to the session that resolved it, so mpv gets the same `User-Agent`, cookies and PO token through `http-header-fields`.
- Stream URLs expire after about six hours, so the player re-resolves a track whose lease is stale.

Volume is perceptual. mpv's `volume` property already applies a cubic taper, so the UI sends the slider position as a linear fraction and never applies the curve again.

### The data engine

`youtubei.js` runs in a **Web Worker**, so InnerTube parsing and BotGuard work stay off the UI thread. The worker is exposed over **Comlink**, which keeps the engine's TypeScript type across the boundary. Engine methods take and return only structured-cloneable values (ids, strings, `Track`s, leases). A youtubei.js continuation is a closure, so it stays in the worker under a handle.

- **CORS.** InnerTube rejects browser-origin requests. The worker has no Tauri IPC, so its `fetch` is serialised to the main thread and sent through `tauri-plugin-http` there, which makes the request in Rust.
- **Stream resolution.** `VISIONOS` first: it needs no token and no evaluator. On failure, or when mpv is refused a stream that resolved, the engine falls back to `TV_SIMPLY` with a PO token.
- **PO tokens.** Google's BotGuard VM mints them, and it needs a real DOM and `eval`. The worker has no DOM, and the app page has a strict CSP and IPC next to Google's code. So BotGuard runs in a hidden iframe on its own `botguard:` scheme, served by Rust with a CSP that allows eval and nothing else, reached only over a MessagePort. Tauri's init scripts, which carry the IPC key, reach the main frame only, and the frame checks this on every load.
- BotGuard's challenge is bound to the `Origin` it was requested from. None and `tauri://localhost` pass; YouTube's own origins and the dev server's are refused, so those requests go out with none.

### Sign-in

OAuth is not an option. InnerTube only takes OAuth tokens from YouTube's TV client, and YouTube began refusing those in late 2024 (yt-dlp dropped them for that reason). So sign-in is a cookie session, like every working third-party client.

Google's own sign-in page opens in an incognito app window with no IPC. Once it lands on `music.youtube.com`, Rust reads the window's cookies, seals them with ChaCha20-Poly1305 under a random key held in the OS keyring, and hands them to the worker. The keyring holds only the key because Credential Manager caps a secret at 2560 bytes and a Google cookie header runs close to that. With no Secret Service running, sign-in still works for the session and the failure to persist is logged.

The Sign in button opens a menu: Google's page as above, or importing the session from a browser that is already signed in. Firefox and its forks store cookies in the clear. Chromium browsers encrypt them; on Linux the key is in the Secret Service. Any config folder whose `Local State` lists profiles counts as a Chromium browser, so forks like Helium turn up without being listed; Electron apps keep the same files but no profile list. Several apps file their key as "Chromium Safe Storage", so the import tries each Chromium key in the keyring and keeps the one whose decrypted values carry the right domain hash. On Windows, Chromium uses app-bound encryption that only the browser can undo, so Windows offers Firefox-family browsers only. An imported session stays shared with the browser, so signing out there signs out here too.

Passkeys do not work in the sign-in window on Linux: WebKitGTK (2.52) ships without WebAuthn, so `PublicKeyCredential` is undefined and Google falls back to the password. WebView2 on Windows has WebAuthn. Importing from a browser is the Linux way to sign in without typing a password.

Only the browsing client is signed in. The `VISIONOS` player client stays anonymous, because a web cookie on a non-web client is exactly the mismatch YouTube flags.

### Libraries and why each is here

- **zod** parses every InnerTube response at the engine boundary into a domain model, so a changed response becomes a clear error instead of an `undefined` three layers down. Also used for the Rust/TS payloads in `packages/ipc`. Types derive from schemas, never the reverse.
- **Comlink** for the worker, and later for the plugin sandbox, so the app has one worker-RPC mechanism.
- **tRPC** is not in the core. It recovers types lost across a network, and the worker and the UI are compiled together, so nothing is lost. It comes back for plugin backends, where there is a real process boundary (see Plugins).
- **shadcn/ui on Base UI** (not Radix), with Tailwind v4. Owned source, which a music player needs for its sliders, menus and virtualized lists. Icons come from `@tabler/icons-react`.
- **SQLite** (`rusqlite`) for the local library index.
- **T3 Env** (`@t3-oss/env-core`), once the app needs an environment value. Nothing does yet, and the repo has no `.env`. The first value brings in one `env.ts` that declares every variable with a zod schema, and code reads them from there, never from `import.meta.env` or `process.env` directly. Client-side values need the `VITE_` prefix, and anything bundled into the frontend is public, so secrets never go there. Build and test tooling (`vite.config.ts`, the `YMUSIC_NETWORK_TESTS` gate, the release scripts) can keep reading `process.env`.

## Monorepo layout

pnpm workspaces and Turborepo. `tsgo` (the TypeScript 7 native compiler) type-checks the workspace; Vite bundles the app.

- `packages/core`: pure TypeScript, no Tauri, no DOM. Domain models and zod schemas, the queue reducer, and the `PlaybackEngine` interface. Mobile can reuse it as is.
- `packages/youtube`: the data engine. The youtubei.js wrapper, the PO-token minter, and the Comlink API, split into `worker` and `host` entry points so the main bundle never imports youtubei.js.
- `packages/ipc`: typed, zod-validated wrappers over Tauri commands and channels. The only package that calls `invoke`.
- `apps/desktop`: the Tauri app. `src/` is the React frontend and its shadcn components. `src-tauri/` is the Rust core: mpv playback, the sealed session and sign-in window, the local library, the `img` scheme, media controls and window chrome. Platform differences live in `platform/`, one module per concern, rather than `#[cfg]`s scattered through features.

## Versions and releases

Semantic versions, one source: `apps/desktop/package.json`. `tauri.conf.json` points at it, and Cargo keeps a copy; `scripts/bump.mjs` writes both. Before 1.0, a minor bump means new features and a patch means fixes.

Commits follow Conventional Commits (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `chore:` and so on). A release is the Release workflow, run by hand from the Actions tab with `patch`, `minor`, `major` or an exact version. It builds the `.deb` at the new version in `debian:13` (the oldest target, so the glibc floor is right) and publishes it with a `SHA256SUMS` file and a build provenance attestation. A stable version commits `chore: release v0.2.0` to `main` over a deploy key, which bypasses the ruleset, and tags that commit. A version with a suffix (`0.2.0-beta.1`) is a prerelease: it tags the built commit and leaves `main` alone, so `package.json` only ever holds stable versions. A dry run stops at a draft release, with no tag and no push.

`scripts/release-notes.mjs` writes the notes: every commit since the previous tag, grouped by type, as "**full commit subject** by @author in #pull", with the short hash when there is no pull request. A stable release counts from the previous stable tag, so it repeats what its prereleases shipped. Commits without a type land under "Other changes", and Dependabot bumps fold into one line.

The CI workflow runs on every push to `main` and every pull request: typecheck and tests for the TypeScript, and rustfmt, clippy (warnings fail) and tests for the Rust core in `debian:13`.

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

- **Faster loading.** `tauri-plugin-http` builds a new reqwest client per request, so every InnerTube call pays a fresh TLS handshake (about a second per page of Liked Music). A Rust fetch command over one shared client fixes that. After that, cache playlist, album and artist pages in SQLite, show the cached copy at once and refresh in the background.
- **Downloads.** The premium stream saved to disk from Rust, with resumable range requests. XDG directories on Linux, known folders on Windows.
- **Linking local files to YouTube tracks.** One `links` table mapping a `local:` id to a `yt:` id, so a downloaded track plays from disk while artist pages, radio and plugin panels still point at YouTube. The grade of each link is stored with it:
  - *Exact, from tags.* yt-dlp's `--embed-metadata` writes the source URL into `PURL`, and ripped libraries often carry `MusicBrainzRecordingId`. The scanner reads neither yet.
  - *Matched.* Title, artist and album normalised, with duration as the tiebreaker. Below a confidence floor, leave it unlinked.
  - *Manual.* A user correction outranks any later rescan.

  Identification is its own background pass, separate from the fast filesystem scan, because it is network-bound and rate-limited. A library with no links still works fully.
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
- Unit tests for the `packages/core` queue and the zod parsers against recorded InnerTube fixtures, with no Tauri. `tsgo` across the workspace.
- Network tests are opt-in: `YMUSIC_NETWORK_TESTS=1 pnpm --filter @ymusic/youtube test`. They cover search, browse, radio, stream resolution, the requests mpv really makes, and the PO-token path (the frame's `frame.js` in jsdom, asserting 206 with a token and 403 without).
- Native feel. Windows: media keys and the volume flyout drive playback, Mica shows, snap layouts work, the app survives a WebView2 update. Linux: the GNOME/KDE media widget shows the track and its controls work, the titlebar follows light and dark, sign-in works with the keyring locked.
- Install the built `.deb` in a clean `debian:13` container in CI and check `dpkg -L`, as the t3code mirror does.
- Cut a bumped draft release and check the updater finds it, verifies the signature, installs through `pkexec dpkg -i`, relaunches, and leaves dpkg consistent. Then check a desktop without `pkexec` gets a clear manual-reinstall message.

## Reference projects

- `LuanRT/YouTube.js` (`youtubei.js`): the InnerTube data layer.
- `LuanRT/BgUtils` (`bgutils-js`): PO tokens and BotGuard.
- limusic (Tauri, Rust, libmpv): prior art for playback and client impersonation.
- Kodama (Tauri 2, React): prior art for the app shell.
- `souvlaki`: media controls on both platforms.
