# Playback

**libmpv in Rust** (`libmpv2`), driven by Tauri commands, with state and position pushed to the frontend over a Tauri `Channel`. Linux links the system `libmpv` and declares it as a package dependency; Windows ships `libmpv-2.dll` beside the binary. The mpv version floor should be explicit, so an old distro libmpv fails at startup with a message rather than a missing symbol.

The engine resolves an audio-only stream URL and mpv streams it over HTTP range requests, with no local proxy. The raw audio stream has no ads: those live in the web player.

Two details that each cost a day if missed:

- googlevideo binds a stream to the session that resolved it, so mpv gets the same `User-Agent`, cookies and PO token through `http-header-fields`.
- Stream URLs expire after about six hours, so the player re-resolves a track whose lease is stale.

Volume is perceptual. mpv's `volume` property already applies a cubic taper, so the UI sends the slider position as a linear fraction and never applies the curve again.
