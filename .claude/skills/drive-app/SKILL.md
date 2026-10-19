---
name: drive-app
description: Launch the real yMusic desktop app (Tauri, mpv, IPC) and click through it to check a change works. Use when asked to run, test, screenshot or try the app, or to confirm a UI or playback change in the real app rather than only in tests.
---

Drive the app with `node scripts/drive.mjs`. Full reference: `docs/testing.md`, "Driving the real app".

1. `node scripts/drive.mjs start`. It builds the debug binary and starts Vite if needed. If it reports WebKitWebDriver missing, ask the user to run `sudo apt install webkitgtk-webdriver`.
2. `snapshot` to see the screen as a list of controls with refs (`e12`). Use `click`, `type`, `press` with those refs or a CSS selector. Take a new snapshot after anything that rerenders: refs go stale.
3. `wait "<text>" <seconds>` after actions that hit the network instead of sleeping.
4. `shot` prints a PNG path; Read it to check layout and visuals.
5. `logs` when something fails, for the Rust and driver output.
6. Always `stop` when done, including after a failure.

Add `--signed-in` to test anything behind sign-in (library playlists, likes, Premium formats) on a copy of the user's session, and `--visible` when judging visuals at the user's real display scale. Without them the app runs on a clean profile, signed out, on a hidden display.

Audio is silent unless `--audio` is passed. Playback still goes through mpv, so the player bar's position and Pause button show whether a track really plays.
