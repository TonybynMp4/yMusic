# The window

## Size and position across restarts

`tauri-plugin-window-state` saves the main window's size, position and whether it is maximized, and puts them back at the next launch. It writes `.window-state.json` in the app config directory (`~/.config/dev.tony.ymusic` on Linux) when the app exits. Only the main window is tracked: the sign-in window opens at its own fixed size each time.

There is no JS side. The plugin restores the window from Rust as it is built, so the frontend never calls it, and `capabilities/` grants none of its commands.

### What is saved

`saved_state` in `platform/window.rs` sets the flags:

- **Size, position, maximized.** While maximized, the plugin keeps the size and position from before, so un-maximizing after a restart goes back to them.
- **Not visibility.** With "Keep playing in the tray" on, closing hides the window, and quitting from the tray menu happens while it is hidden. Saving that would bring the app back invisible, so every launch shows the window.
- **Not decorations.** They are always off, because the title bar is ours (`TitleBar.tsx`). Restoring them could put a native frame above it.
- **Not fullscreen.** The app has no fullscreen mode.

### No flash at the default size

The window starts hidden (`"visible": false` in `tauri.conf.json`). Tauri initialises plugins before it builds the windows from the config, and the plugin restores each window as it is built, so by the time `setup` runs the hidden window already has its saved size and position. `setup` shows it as its last step, once mpv has started and all the state the page can call into is in place. If mpv fails, the window stays hidden behind the error dialog, as before.

The window-state plugin is registered after single-instance, so a second launch still hands over to the running window before anything else happens. The single-instance callback and the tray both go through `tray::show_window`, which un-minimizes, shows and focuses the window and leaves its size alone.

### A monitor that is gone

The plugin only restores a position if one corner of the saved window lands on a connected monitor. Otherwise it leaves the position to the system. One corner is not enough to reach the window, though: a window whose bottom corner pokes onto a screen can have its title bar above it, and the title bar is the only way to drag it.

So `keep_on_screen` runs after the restore. When the top strip of the window, the title bar's height, has its middle on no monitor's work area, the window moves to the middle of the primary monitor, shrunk to fit if it is bigger than that monitor. A maximized window is left alone, since maximizing places it on a screen. `placement` is the pure part and has unit tests.

### Hide to tray, minimize

Closing to the tray goes through `CloseRequested`, where the plugin records the window's state before it hides. Moves and resizes while minimized or maximized are not recorded, so quitting from either state keeps the last normal size and position.

### Wayland

On Wayland the compositor places windows. A window reads its position as (0, 0) and cannot move itself, so only the size and maximized state come back. GNOME centres a window each time it appears, which includes Show from the tray after closing to it.

`saved_state` leaves position out there, and `keep_on_screen` does nothing: with no real position it would decide the window is off screen on every launch. Leaving it out also keeps a position saved under X11 from being overwritten with (0, 0) by a Wayland session. GTK picks its backend from `WAYLAND_DISPLAY` and `GDK_BACKEND`, and `is_wayland` reads them the same way, because the plugin is built before GTK starts.

The fix is the `xdg-session-management-v1` protocol (wayland-protocols 1.48): the compositor puts a window back where it was when the app names its session. Mutter and KWin are adding it, but GTK3 will never support it, and GTK4 has no public API for it yet. It becomes possible once GTK4 publishes one and Tauri moves to GTK4 ([tauri#7335](https://github.com/tauri-apps/tauri/issues/7335)).
