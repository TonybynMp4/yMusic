# Progress

Where yMusic stands. How the built parts work is in [docs/](docs/README.md), and what is planned is in [PLAN.md](PLAN.md). Tick items off here in the same commit that finishes them.

Everything ticked has been run on Linux. Nothing has been run on Windows yet.

## MVP

The MVP is done when you can sign in, search, play and manage a queue, on both platforms, from a tagged GitHub release.

### Shell

- [x] pnpm and Turborepo workspace, Tauri 2, React, Vite, Tailwind v4
- [x] shadcn on Base UI, YouTube Music's dark palette, Tabler icons
- [x] Custom titlebar
- [ ] Mica on Windows (code is in `platform/window.rs`, never run)
- [x] Single instance: a second launch focuses the running window
- [x] Explicit libmpv version floor with a clear startup error

### Playback

- [x] libmpv in Rust: load, play, pause, seek, volume, state and position over a `Channel`
- [x] Perceptual volume (mpv's cubic taper, applied once)
- [x] Mute button next to the volume slider, restoring the previous level
- [x] Gapless audio in mpv
- [x] Stale stream leases re-resolved before playing
- [x] Resolve the next YouTube track while the current one plays, so there is no gap while its stream resolves
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
- [x] Plays reported to the account: history when a song starts, watch time as it plays
- [x] Play reporting checked against a signed-in account's history
- [x] Resume: the account's last queue waits in the player bar at launch, and what plays here becomes the account's queue
- [ ] Resume checked both ways against another device

### Queue

- [x] Queue reducer: shuffle, repeat one and all, jump, remove, clear
- [x] Full-page player with the queue as a tab
- [x] Playing a playlist queues all of it, including pages still loading
- [x] Shuffle mixes rows that arrive later into the tracks still to come
- [x] A search result starts that song's radio
- [x] Autoplay: YouTube Music's suggestions after the queue, with a switch
- [x] Reorder the queue by dragging
- [x] The queue follows the playing song, with a button back to it when it is out of view
- [x] "Play next" and "Add to queue" in a track's menu

### Local library

- [x] Scan folders into SQLite and play from disk
- [x] Folders and all files in the sidebar

### Releases

- [x] One version, in `apps/desktop/package.json`; Tauri reads it and `scripts/bump.mjs` copies it into Cargo
- [x] Release workflow, run by hand: builds the `.deb` in `debian:13`, then commits the bump, tags and publishes a GitHub release with notes grouped by commit type
- [ ] Prereleases tag the built commit without a bump commit, and dry runs stop at a draft (written, not run yet)
- [ ] Release assets carry `SHA256SUMS` and a build provenance attestation (written, not run yet)
- [x] CI on every push to `main` and every pull request: oxlint, typecheck, tests, rustfmt and clippy
- [ ] Windows build in the release workflow (needs `libmpv-2.dll` bundled)
- [ ] Run the whole MVP on Windows
- [x] Nightly run of the live YouTube tests that opens an issue when they fail

## After the MVP

### Packaging and updates

- [ ] `.deb` with AppStream metadata, a build-time install flavour, and the package named `ymusic` (Tauri names it `y-music` after the product name)
- [ ] In-app updater for the `.deb`: check `latest.json`, download, `pkexec dpkg -i`, relaunch
- [ ] Clear manual-update message when `pkexec` is missing
- [ ] Signed release assets (minisign)
- [ ] CI: install the `.deb` in `debian:13`, check `dpkg -L` and start the app under Xvfb (written, not run yet)
- [ ] Windows installer (MSI/NSIS with the WebView2 bootstrapper) and updater

### Interactions

- [x] One menu per song, album, playlist and artist, behind a right click and behind the dots button
- [x] Songs: start mix, play next, add to queue, save to playlist, go to album, go to artist
- [x] "New playlist" in the save-to-playlist menu, with a title, description and privacy
- [x] Albums and playlists: shuffle play, start mix, play next, add to queue, save to library, save to playlist, go to artist
- [x] Artists: shuffle play, start mix, play next, add to queue, subscribe and unsubscribe
- [x] Player bar: a click opens the full player, a right click the song's menu
- [x] Player bar and full player: title, album and artists open their pages, with the release year in the byline
- [ ] Pin and unpin albums, playlists and artists to quick access on the home page
- [x] Like and dislike songs
- [x] Setting to skip disliked songs
- [x] Like and dislike from a song's menu
- [x] Disliked songs dimmed in lists and the queue
- [ ] Dismiss the queue in one click
- [ ] Song credits dialog, from a song's menu and from an album's when YouTube has credits for it
- [x] Menus on the queue's rows, with remove from queue
- [x] Local folders: open in files. Local songs: show in files, with the file selected

### Settings

- [x] Settings saved to a file in Rust, read before the first render
- [x] Settings page, opened from the account menu
- [x] Autoplay remembered across restarts
- [x] Audio quality: high, normal, low
- [x] Stable volume: YouTube's loudness value per track, ReplayGain for local files
- [x] Audio output device
- [x] Stats for nerds: stream, gain, loudness, peaks and limiter over the artwork
- [x] Pause watch history
- [x] Pause search history
- [x] Music folders: add, remove, rescan
- [x] Keep playing in the tray when the window closes
- [x] Update check at startup, with prereleases opt-in and a link to the release
- [x] About: version, logs folder, source code, issue link
- [x] Account: sign in, import from a browser, sign out

### Features

- [x] Pooled HTTP for InnerTube (one shared reqwest client instead of a TLS handshake per request)
- [ ] Metadata cache in SQLite for playlist, album and artist pages
- [ ] Home and Explore pages
- [ ] Saved albums and artists in the library
- [ ] Local playlists
- [ ] Downloads: the premium stream saved to disk
- [ ] Linking local files to YouTube tracks (tags, matching, manual)
- [ ] Plugins: worker sandbox, capabilities, `player.panel` and the other slots
- [ ] Plugin backends on Deno over tRPC
- [ ] Flatpak
- [ ] Sync service
- [ ] Remote control between devices, like Spotify Connect (see PLAN.md)
- [ ] Mobile

## Known issues

- YouTube Music sometimes answers a radio request with nothing. Autoplay then waits until the queue's last song changes before asking again, so the queue can end with no suggestions.
- In debug builds on Linux, tao logs `Couldn't get key from code` for the volume keys. It is harmless and gone in release builds.
