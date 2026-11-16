# The window

## Size and position across restarts

`tauri-plugin-window-state` saves the main window's size, position and whether it is maximized, and puts them back at the next launch. It writes `.window-state.json` in the app config directory (`~/.config/dev.tony.ymusic` on Linux) when the app exits, and `lib.rs` also has it write the file when the main window is closed (to the tray or not) or loses focus, if it has moved, resized or (un)maximized since the last write. A logout, a kill or a crash skips the save on exit, so without those the file would only hold what the last clean quit saw. Only the main window is tracked: the sign-in window opens at its own fixed size each time.

There is no JS side. The plugin restores the window from Rust as it is built, so the frontend never calls it, and `capabilities/` grants none of its commands.

### What is saved

`saved_state` in `platform/window.rs` sets the flags:

- **Size, position, maximized.** While maximized, the plugin keeps the size from before, and the position from before in `prev_x` and `prev_y`, so un-maximizing after a restart goes back to them. See below for when that position is lost.
- **Not visibility.** With "Keep playing in the tray" on, closing hides the window, and quitting from the tray menu happens while it is hidden. Saving that would bring the app back invisible, so every launch shows the window.
- **Not decorations.** They are always off, because the title bar is ours (`TitleBar.tsx`). Restoring them could put a native frame above it.
- **Not fullscreen.** The app has no fullscreen mode.

### No flash at the default size

The window starts hidden (`"visible": false` in `tauri.conf.json`). Tauri initialises plugins before it builds the windows from the config, and the plugin restores each window as it is built. On Windows that happens at once. On Linux, tao only queues the moves, resizes and maximize for its event loop, and keeps the geometry it reports in values that only a configure event updates, which a window that has never been mapped does not get. So in `setup` the window still reads its creation-time geometry on Linux: anything there that needs the restored size or position has to read the saved file, as `keep_on_screen` does. `setup` shows it as its last step, once mpv has started and all the state the page can call into is in place. If mpv fails, the window stays hidden behind the error dialog. The plugin still saves on the way out, and from a window that was never shown it would save the creation-time geometry over where the user left it, so the dialog ends the process with `std::process::exit(1)`, which skips that save, rather than `AppHandle::exit`. No other exit hook has work to do on that path (there is no player whose position or volume to save), and the log is flushed first. For the same reason the tray icon is only added once mpv has started: its Quit goes through `AppHandle::exit`.

The window-state plugin is registered after single-instance, so a second launch still hands over to the running window before anything else happens. The single-instance callback, the tray and the media controls' Raise all go through `tray::show_window`, which un-minimizes, shows and focuses the window and leaves its size alone. Until `setup` has shown the window (`window::reveal`) it only notes the request, and `reveal` then focuses the window as it shows it. A login launch into the tray calls `reveal` without showing the window, unless such a request came in (see [Open at login](settings.md)). So a second launch while setup runs (the single-instance callback runs on its own thread on Linux) brings the window forward once it is ready, and one while mpv's error dialog is up does not reveal a window with no player behind it.

### A monitor that is gone

The plugin only restores a position if one corner of the saved window lands on a connected monitor. Otherwise it leaves the position to the system. One corner is not enough to reach the window, though: a window whose bottom corner pokes onto a screen can have its title bar above it, and the title bar is the only way to drag it.

So `keep_on_screen` checks the saved position from `.window-state.json`, not the window, which on Linux has not moved yet (above). When the top strip of the saved window, the title bar's height at that monitor's scale, has its middle on no monitor, the window moves to the middle of the primary monitor's work area, shrunk to fit if it is bigger than that. The check uses whole monitors rather than work areas, so a title bar under a top panel the window manager lets windows overlap stays where it is. Its requests queue behind the plugin's, so they win. For a window saved maximized, the plugin maximizes it on a screen but restores the position it un-maximizes to (`prev_x`, `prev_y`) without checking it, so that is the position checked, and a move goes between an un-maximize and a fresh maximize so it becomes the un-maximized place. The size is left alone when it already fits. `placement` is the pure part and has unit tests.

### Hide to tray, minimize

Closing to the tray goes through `CloseRequested`, where the window's state is saved before it hides. Resizes while minimized or maximized are not recorded, and neither are moves while minimized, so quitting from either state keeps the last normal size.

Moves while maximized are recorded, though. Each move shifts the old position into `prev_x` and `prev_y`, which is what un-maximizing after a restart goes back to. When maximizing produces one move, that is the position from before. When it produces more (GTK can send several), `prev_x` and `prev_y` end up at the monitor's corner, and the window un-maximizes there after a restart. This is the plugin's behaviour and its cache is private, so the app cannot correct it.

### Wayland

On Wayland the compositor places windows. A window reads its position as (0, 0) and cannot move itself, so only the size and maximized state come back. GNOME centres a window each time it appears, which includes Show from the tray after closing to it.

`saved_state` leaves position out there, and `keep_on_screen` does nothing: with no real position it would decide the window is off screen on every launch. Leaving it out also keeps a position saved under X11 from being overwritten with (0, 0) by a Wayland session. `is_wayland` decides the way GDK does, because the plugin is built before GTK starts: Wayland when `GDK_BACKEND` is unset, `*` or lists `wayland` first, and the socket libwayland would use (`WAYLAND_DISPLAY`, or `wayland-0` when unset, under `XDG_RUNTIME_DIR`) accepts a connection. GDK falls back to X11 when that connection fails, which is what happens with a `WAYLAND_DISPLAY` inherited from another session.

The fix is the `xdg-session-management-v1` protocol (wayland-protocols 1.48): the compositor puts a window back where it was when the app names its session. Mutter and KWin are adding it, but GTK3 will never support it, and GTK4 has no public API for it yet. It becomes possible once GTK4 publishes one and Tauri moves to GTK4 ([tauri#7335](https://github.com/tauri-apps/tauri/issues/7335)).
