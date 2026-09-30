# Playback

**libmpv in Rust** (`libmpv2`), driven by Tauri commands, with state and position pushed to the frontend over a Tauri `Channel`. Linux links the system `libmpv` and declares it as a package dependency; Windows ships `libmpv-2.dll` beside the binary.

The floor is mpv 0.35, the first release with `libmpv.so.2`. The binary imports ten libmpv functions, all present since client API 2.0, so the library name is the whole requirement. The `.deb` depends on `libmpv2 (>= 0.35)`, and a hand-run binary on an older system stops in the dynamic loader before any of our code runs. If mpv itself fails to start, the app hides its window, shows an error dialog naming the package, and quits when it is closed. The startup log records the loaded version (`playing through mpv v0.41.0`).

The engine resolves an audio-only stream URL and mpv streams it over HTTP range requests, with no local proxy. The raw audio stream has no ads: those live in the web player.

Two details that each cost a day if missed:

- googlevideo binds a stream to the session that resolved it, so mpv gets the same `User-Agent`, cookies and PO token through `http-header-fields`.
- Stream URLs expire after about six hours, so the player re-resolves a track whose lease is stale.

Volume is perceptual. mpv's `volume` property already applies a cubic taper, so the UI sends the slider position as a linear fraction and never applies the curve again.

The queue, in the full player's Up next tab, keeps the playing song in view. Opening it centres that row before the first paint. When the song changes and the new row is out of view, the list scrolls to it, unless the old row was out of view too: then you had scrolled away to read the list, and it stays where you left it. While the playing row is hidden, a "Now playing" button at the top or bottom edge, on the side where the row is, scrolls back to it. Rows are a fixed 48 px, so the row's offset is its position times that, with no measuring.
