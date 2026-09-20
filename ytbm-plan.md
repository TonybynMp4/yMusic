# YTBM: a native YouTube Music player

## Context

Greenfield build, empty repo. Goal: a YouTube Music player that feels native on Windows and Linux and stays in the TypeScript world.

Constraints the user set:

- React and TypeScript. No Electron, no Flutter, no being stuck in C#.
- Windows and Linux are both first-class targets, shipped together. Mobile later.
- Playback should use libmpv.
- Preferred libs: Tauri, tRPC, shadcn/ui, better-auth, zod.

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

`souvlaki` covers SMTC and MPRIS behind one API, and `keyring-rs` covers Credential Manager and Secret Service behind another, so both rows are one code path with two backends rather than two implementations. The place to plan for divergence is Linux machines with no running Secret Service — detect that at startup and fall back to an encrypted token file with a clear warning, rather than failing sign-in.

Tauri also removes the hidden-webview contortion from the previous plan. The frontend *is* a Chromium DOM, so `youtubei.js` and BotGuard both run in-process. Two details make it work:

- **CORS.** InnerTube rejects browser-origin requests. `youtubei.js` accepts a custom `fetch`; we hand it `tauri-plugin-http`'s fetch, which performs the request in Rust and bypasses CORS entirely while letting us control headers and cookies.
- **PO tokens.** These are minted continuously at runtime, rotate per session and per video, and require running Google's BotGuard JS in a live DOM. We have one. `bgutils-js` runs in a Web Worker alongside the data engine. As in the previous plan, `youtubei.js` first impersonates JS-less clients (`tv_embedded`, `ios` HLS) that historically skip PO tokens and only falls back to minting one when a request demands it.

Audio plays through **libmpv in Rust** (`libmpv2` crate), driven by Tauri commands, with state and position pushed back to the frontend over a Tauri `Channel`. On Linux we link the system `libmpv` and declare it as a package dependency; on Windows we ship `libmpv-2.dll` beside the binary. Same Rust, different linking — keep the mpv version floor explicit so a distro's older libmpv fails at startup with a real message instead of a missing symbol. The engine resolves an audio-only stream URL and hands it to mpv, which streams it directly over HTTP range requests — no local proxy. Playing the raw audio-only stream is also what makes playback ad-free: the ads live in the web player, not in the stream.

Two mpv details that will otherwise cost a day each: googlevideo binds the stream to the requesting session, so mpv must be given the same `User-Agent`, cookies, and PO token via `http-header-fields` that resolved the URL; and stream URLs expire in roughly six hours, so the queue re-resolves a track's URL if its lease is stale before enqueueing it. Set `gapless-audio=yes` and prefetch the next queue item for seamless transitions.

### Where each requested library earns its place

**zod** — the spine. InnerTube responses are undocumented and change without notice, so every response is parsed at the engine boundary into a domain model; a schema failure becomes a legible error instead of a downstream `undefined`. Also used for tRPC procedure inputs, the settings file, and every payload crossing the Rust↔TS boundary. Derive TypeScript types from the schemas, never the other way around.

**tRPC** — needs a real boundary to be worth anything, and in a desktop app there is only one natural candidate: the data engine runs in a **Web Worker**, not on the UI thread. That keeps `youtubei.js` parsing and BotGuard attestation (which is genuinely slow and bursty) off the render thread, and it gives tRPC a client/server split to type. A ~40-line custom tRPC link over `MessageChannel` carries the calls; `@trpc/tanstack-react-query` handles caching, deduping, and infinite scroll for search and browse results, which is most of the reason to bother.

  Rust commands are *not* wrapped in tRPC — an `invoke` with a zod-parsed result is already typed and adding a router on top buys nothing. `packages/ipc` holds those thin typed wrappers instead. If a sync service appears later (below), its router reuses the same pattern and the frontend calls both through one client style.

**shadcn/ui** — the UI layer, with Tailwind v4. Owned source rather than a dependency, which matters because a music player needs heavily customized sliders, context menus, and virtualized lists. Theme tokens are driven from the Windows accent color and light/dark setting read via Tauri.

**better-auth** — worth being precise about, because it does not fit the YouTube login. Signing into YouTube Music means Google OAuth with YouTube scopes, consumed by `youtubei.js`'s own OAuth flow; we run it through the system browser with a `ytbm://` deep-link callback (`tauri-plugin-deep-link`) and store the refresh token in the Windows credential store via `keyring-rs`. No embedded login page, and no auth framework in that path.

  better-auth belongs to the **optional sync service** (`services/sync`): a small Hono server that owns YTBM accounts so settings, local-library metadata, download state, and play history can follow the user to a second desktop or to mobile. That is a post-MVP phase, and the desktop app works fully without it. Building it there rather than bolting sessions onto the local app is the difference between using better-auth and misusing it.

## Monorepo layout

pnpm workspaces plus Turborepo. `tsgo` (TypeScript 7 native compiler) for workspace type-checking; Vite for the app bundle.

- `packages/core` — pure TypeScript, no Tauri and no DOM. Domain models and zod schemas, the playback queue and transport state machine, the `PlaybackEngine` interface, and the auth token-store interface. Framework-agnostic so mobile can reuse it verbatim.
- `packages/data-engine` — runs in the Web Worker. The `youtubei.js` wrapper (search, browse, library, playlists, `getStreamingData`), the `bgutils-js` PO-token provider, and the tRPC router. No React, no direct Tauri window APIs.
- `packages/ipc` — typed, zod-validated wrappers over Tauri commands and event channels. The only file in the repo that calls `invoke`.
- `packages/ui` — shadcn components, theme tokens, and the player-specific primitives (seek bar, volume, queue row, marquee title).
- `apps/desktop` — the Tauri app. `src/` is the React frontend; `src-tauri/` is the Rust core: mpv playback, keyring, deep-link OAuth callback, downloads, local-library indexing, media controls (`souvlaki`), single-instance, tray, and updater. Platform differences live in a `platform/` module with one trait per concern, not in `#[cfg]`s scattered through feature code.
- `services/sync` — post-MVP. Hono plus better-auth plus Drizzle/SQLite.

## MVP (Windows and Linux)

Target: sign in, search, play a track, control playback and the queue — on both platforms, from the same commit. Develop on whichever machine is in front of you, but run the other before calling a step done; catching a WebKitGTK or Secret Service divergence a week late costs far more than the fifteen minutes it takes to check.

In build order:

1. Scaffold the pnpm/Turborepo workspace and the Tauri 2 app with React, Vite, Tailwind v4, and shadcn/ui. Empty window building and running on both targets, custom titlebar in place, Mica on Windows and the themed fallback on Linux.
2. libmpv in Rust. Commands for load, play, pause, seek, and volume; a `Channel` emitting position and state. Prove it against a plain HTTPS audio URL before any YouTube code exists, on both platforms — this is where the bundled-versus-system linking split gets settled.
3. The data-engine worker. `youtubei.js` over `tauri-plugin-http` fetch, the tRPC router and `MessageChannel` link, zod schemas for the response shapes, and `search` plus `getStreamingData` working end to end.
4. OAuth through the system browser with the `ytbm://` deep-link callback — installer-registered on Windows, `.desktop` handler on Linux — and the refresh token in the platform secret store.
5. The PO-token provider (`bgutils-js`) in the worker, with JS-less client impersonation as the first-choice path and minting as the fallback.
6. UI: search screen, now-playing bar, queue view. Wire `packages/core`'s queue and transport to the mpv commands. `souvlaki` for SMTC and MPRIS so media keys work on both.
7. Packaging and updates. Windows: MSI/NSIS with the WebView2 bootstrapper, updated by `tauri-plugin-updater` directly. Linux: a `.deb` attached to a GitHub release — no AppImage, no hosted apt repo.

    The t3code mirror already proves this shape in production, so copy it rather than rediscovering it. Its Linux workflow builds `.deb` and `.rpm` from upstream tags and publishes them to the fork's own releases, and a patch (`0001-linux-deb-rpm-auto-update`) makes those installs updatable in place. The mechanism is exactly the one to reproduce: download the new package, apply it with `pkexec dpkg -i`, relaunch. One password prompt, the same way Windows prompts through UAC, and dpkg stays authoritative over `/usr`.

    The one thing that does not carry over is the plumbing. electron-updater ships `DebUpdater`/`RpmUpdater` for free; `tauri-plugin-updater` has no `.deb` target at all, so on Linux we use it only for the version check against the release's `latest.json` and write the download-and-install step ourselves. Four details the mirror learned the hard way are worth taking as given:

    - **Record the install flavor at build time.** electron-builder writes a `package-type` resource that electron-updater reads back to decide which updater to construct; the mirror's patch works by trusting that same marker. We need our own equivalent — a build-time constant saying "installed from the `.deb`" — so a hand-run binary or a future Flatpak gets "a new version is available" with a link instead of a broken upgrade button.
    - **No `pkexec` means no auto-update.** Detect it and say so plainly, pointing at manual reinstall, rather than failing mid-install.
    - **Log the updater's error cause.** The mirror needed a whole patch (`0005`) for this because update failures are otherwise opaque. Build it in from the start.
    - **`.deb` needs package metadata AppImage never asked for** — maintainer, section, dependencies, and an AppStream metainfo file so GNOME Software and Discover describe the app instead of showing a bare binary. That is mirror patches `0002` and `0003`, and it is real work, not a checkbox.

    Sign the release assets with the updater's minisign key so the download is verified before it is handed to dpkg.

    One thing gets *easier* than the mirror's experience: its `.desktop` deep-link handling is convoluted because an AppImage's `process.execPath` points into a transient `/tmp/.mount_*` directory. A `.deb` installs a stable exec path and its own `.desktop` file, so the `ytbm://` handler in step 4 is straightforward by comparison.

## Roadmap after MVP

- Library and playlists via `youtubei.js`.
- Downloads to local files — the premium stream saved to disk, written in Rust with resumable range requests. This is the real "offline." Respect XDG base directories on Linux and the known-folder paths on Windows.
- Local music library. Index on-disk files in Rust, play through the same mpv layer behind `PlaybackEngine`.
- Flatpak, after the `.deb` is solid — it needs portal-based file access and a bundled libmpv, and it brings its own update mechanism, which is why it comes second rather than instead. An apt repo is worth revisiting only if other people start installing this; for one user, a release asset is the whole story.
- Sync service with better-auth, once there is a second device to sync to.
- Mobile via Tauri 2's iOS/Android targets, reusing `packages/core` and `packages/data-engine`. libmpv is heavy on iOS, so expect a platform player behind the `PlaybackEngine` interface — which is why that interface exists.

## Risks

- **PO-token and BotGuard fragility.** Breaks whenever Google changes BotGuard. Isolated in the data engine so fixes stay in one place; client impersonation reduces how often we depend on it at all.
- **Stream-session binding.** Header, cookie, and token mismatch between the resolving fetch and mpv produces 403s that look like bugs elsewhere. Keep resolution and playback handoff in one code path.
- **WebView2 is not WinUI.** Accepted deliberately, mitigated by the platform integration listed above. If native controls later prove essential, `packages/core` and `packages/data-engine` port to a `react-native-windows` shell without rewriting the engine.
- **WebKitGTK is the weaker of the two webviews**, and it is the one carrying BotGuard. It lags Chromium on JS features and performance, needs `WEBKIT_DISABLE_DMABUF_RENDERER=1` on several driver and compositor combinations to avoid a blank window, and is fingerprinted differently by Google. Expect the PO-token path to degrade on Linux before it degrades on Windows — another argument for treating JS-less client impersonation as the default path rather than an optimization.
- **Linux distribution fragmentation.** libmpv version skew, a missing Secret Service, and WebKitGTK 4.0 versus 4.1 are the three that will actually bite. Pin the floor versions, detect at startup, and fail with a message that names the missing piece.
- **tRPC is load-bearing only for the worker boundary.** If the worker ever collapses back onto the main thread, tRPC should be dropped rather than kept as ceremony.
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
