# Progress

Where yMusic stands. The design and its reasons are in [PLAN.md](PLAN.md). Tick items off here in the same commit that finishes them.

Everything ticked has been run on Linux. Nothing has been run on Windows yet.

## MVP

The MVP is done when you can sign in, search, play and manage a queue, on both platforms, from a tagged GitHub release.

### Shell

- [x] pnpm and Turborepo workspace, Tauri 2, React, Vite, Tailwind v4
- [x] shadcn on Base UI, YouTube Music's dark palette, Tabler icons
- [x] Custom titlebar
- [ ] Mica on Windows (code is in `platform/window.rs`, never run)
- [ ] Single instance
- [ ] Explicit libmpv version floor with a clear startup error

### Playback

- [x] libmpv in Rust: load, play, pause, seek, volume, state and position over a `Channel`
- [x] Perceptual volume (mpv's cubic taper, applied once)
- [x] Gapless audio in mpv
- [x] Stale stream leases re-resolved before playing
- [ ] Resolve the next YouTube track ahead of time (`peekNext` exists, nothing calls it), so there is no gap while its stream resolves
- [x] Media keys and the desktop media widget over MPRIS
- [ ] SMTC on Windows (shares the `souvlaki` code path, never run)

### YouTube

- [x] Data engine in a Web Worker over Comlink, with fetch sent through Rust
- [x] Search, with YouTube Music and local files in one box
- [x] Stream resolution on `VISIONOS`
- [x] PO-token fallback on `TV_SIMPLY`, with BotGuard in an isolated frame
- [x] Sign-in through Google's page, session sealed with a keyring-held key
- [x] Import the session from Firefox-family browsers, and on Linux from Chromium browsers
- [x] Import tested against a signed-in Chromium profile (Helium)
- [ ] Import tested on Windows
- [x] Account menu with the profile picture
- [x] Album, artist and playlist pages
- [x] Library playlists in the sidebar, Liked Music first
- [x] Long playlists load progressively, with virtualized lists
- [x] Artwork through the `img` scheme with retries and a disk cache

### Queue

- [x] Queue reducer: shuffle, repeat one and all, jump, remove, clear
- [x] Full-page player with the queue as a tab
- [x] Playing a playlist queues all of it, including pages still loading
- [x] Shuffle mixes rows that arrive later into the tracks still to come
- [x] A search result starts that song's radio
- [x] Autoplay: YouTube Music's suggestions after the queue, with a switch
- [ ] Reorder the queue by dragging
- [ ] "Play next" from a track's menu (the reducer has `enqueueNext`; only "add to queue" is in the UI)

### Local library

- [x] Scan folders into SQLite and play from disk
- [x] Folders and all files in the sidebar

### Releases

- [x] One version, in `apps/desktop/package.json`; Tauri reads it and `scripts/bump.mjs` copies it into Cargo
- [ ] Release workflow, run by hand: builds the `.deb` in `debian:13`, then commits the bump, tags and publishes a GitHub release with notes grouped by commit type (written, not run yet)
- [x] CI on every push to `main` and every pull request: typecheck, tests, rustfmt and clippy
- [ ] Windows build in the release workflow (needs `libmpv-2.dll` bundled)
- [ ] Run the whole MVP on Windows

## After the MVP

### Packaging and updates

- [ ] `.deb` with AppStream metadata, a build-time install flavour, and the package named `ymusic` (Tauri names it `y-music` after the product name)
- [ ] In-app updater for the `.deb`: check `latest.json`, download, `pkexec dpkg -i`, relaunch
- [ ] Clear manual-update message when `pkexec` is missing
- [ ] Signed release assets (minisign)
- [ ] CI: install the `.deb` in `debian:13` and check `dpkg -L`
- [ ] Windows installer (MSI/NSIS with the WebView2 bootstrapper) and updater

### Features

- [ ] Pooled HTTP for InnerTube (one shared reqwest client instead of a TLS handshake per request)
- [ ] Metadata cache in SQLite for playlist, album and artist pages
- [ ] Home and Explore pages
- [ ] Saved albums and artists in the library
- [ ] Local playlists
- [ ] Like and unlike songs, add to a playlist
- [ ] Downloads: the premium stream saved to disk
- [ ] Linking local files to YouTube tracks (tags, matching, manual)
- [ ] Plugins: worker sandbox, capabilities, `player.panel` and the other slots
- [ ] Plugin backends on Deno over tRPC
- [ ] Flatpak
- [ ] Sync service
- [ ] Mobile

## Known issues

- YouTube Music sometimes answers a radio request with nothing. Autoplay then waits until the queue's last song changes before asking again, so the queue can end with no suggestions.
- In debug builds on Linux, tao logs `Couldn't get key from code` for the volume keys. It is harmless and gone in release builds.
