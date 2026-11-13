# Testing

- Unit tests for the `packages/core` queue and the zod parsers against recorded InnerTube fixtures, with no Tauri. In the app, `useBrowse` against a fake engine (which pages the cache keeps, and how a long playlist loads, retries and resumes). `tsc` across the workspace.
- Network tests are opt-in: `YMUSIC_NETWORK_TESTS=1 pnpm --filter @ymusic/youtube test`. They cover search, browse, radio, stream resolution, the requests mpv really makes, and the PO-token path (the frame's `frame.js` in jsdom, asserting 206 with a token and 403 without). When the player endpoint answers with its bot check, the stream tests skip instead of failing. YouTube asks that of many datacenter addresses, GitHub's runners among them, so the nightly run covers search, browse and radio, and stream resolution needs a run from a home connection.

## Driving the real app

`scripts/drive.mjs` runs the debug binary under `tauri-driver`, so an agent (or you) can click through the real app: real IPC, real mpv, real YouTube. The Vite page alone misses everything behind `isTauri`.

It needs `tauri-driver` (`cargo install tauri-driver --locked`) and WebKit's WebDriver (`sudo apt install webkitgtk-webdriver`). Linux only, since WebKitGTK is the only Tauri webview with a WebDriver.

```
node scripts/drive.mjs start          # cargo build, Vite if not running, launch
node scripts/drive.mjs snapshot       # controls on screen, each with a ref like e12
node scripts/drive.mjs click e12
node scripts/drive.mjs type e10 daft punk
node scripts/drive.mjs press Enter
node scripts/drive.mjs wait "Songs" 20
node scripts/drive.mjs shot           # prints the PNG path
node scripts/drive.mjs eval "return document.title"
node scripts/drive.mjs logs           # tail of the app and driver output
node scripts/drive.mjs stop
```

Refs come from the last `snapshot` and go stale when the page changes, so take a new one after anything that rerenders.

`start` isolates the app. It gets a fresh profile under `$XDG_RUNTIME_DIR/ymusic-drive/profile` (its own library, settings and cache), its own D-Bus session (so the single-instance lock does not hand off to a yMusic you have open, and the keyring is empty), an Xvfb display, and `YMUSIC_AUDIO_OUTPUT=null`. `--visible` shows the window on your screen instead of Xvfb, for visual checks at your real scale and theme. `--audio` plays through your speakers, `--no-build` skips `cargo build`.

`--signed-in` copies your `account.bin` into the profile and has the debug binary export its key from your keyring to `profile/account.key` (`--export-account-key`, debug builds only). The app then reads the key from that file through `YMUSIC_ACCOUNT_KEY_FILE` instead of the keyring, so signing out in the copy cannot sign out your own app. `stop` deletes the key file. Re-importing a stale browser session does not work in the copy, since the browser's key is in your keyring and the copy has its own.

A signed-in run acts on your real account: the copy holds your live cookies, so a like, a playlist edit or a sign-out in the copy reaches YouTube. The app shows YouTube's text (titles, descriptions), and `snapshot` hands that text to the agent, which is why the skill makes agents ask before using `--signed-in`.

`tauri-driver` has no authentication, and a new session launches whatever binary it names. `start` puts it on a random port and opens its one session straight away (a second one is refused), but until `stop` it is a local surface into the app, so stop it when you are done.
