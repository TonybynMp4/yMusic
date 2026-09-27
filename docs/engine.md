# The data engine

`youtubei.js` runs in a **Web Worker**, so InnerTube parsing and BotGuard work stay off the UI thread. The worker is exposed over **Comlink**, which keeps the engine's TypeScript type across the boundary. Engine methods take and return only structured-cloneable values (ids, strings, `Track`s, leases). A youtubei.js continuation is a closure, so it stays in the worker under a handle.

- **CORS.** InnerTube rejects browser-origin requests. The worker has no Tauri IPC, so its `fetch` is serialised to the main thread and sent through `tauri-plugin-http` there, which makes the request in Rust.
- **Stream resolution.** `VISIONOS` first: it needs no token and no evaluator. On failure, or when mpv is refused a stream that resolved, the engine falls back to `TV_SIMPLY` with a PO token.
- **PO tokens.** Google's BotGuard VM mints them, and it needs a real DOM and `eval`. The worker has no DOM, and the app page has a strict CSP and IPC next to Google's code. So BotGuard runs in a hidden iframe on its own `botguard:` scheme, served by Rust with a CSP that allows eval and nothing else, reached only over a MessagePort. Tauri's init scripts, which carry the IPC key, reach the main frame only, and the frame checks this on every load.
- BotGuard's challenge is bound to the `Origin` it was requested from. None and `tauri://localhost` pass; YouTube's own origins and the dev server's are refused, so those requests go out with none.

## Reporting plays

Signed in, the engine tells YouTube what plays, the way YouTube Music's web player does, so songs land in the account's history, count towards recommendations and can feed "Resume" on other devices. Local files are never reported.

- **The URLs.** A play's reports go to the tracking URLs in a `/player` response. The stream comes from the anonymous `VISIONOS` client, so the engine makes a second, signed-in `/player` call on `WEB_REMIX` for the URLs alone. Without the player script's signature timestamp that call comes back "unplayable" with no URLs, so it borrows the timestamp from the player client, which has the script loaded anyway.
- **The reports.** One to `api/stats/playback` when the song first plays, which is the history entry. Then `api/stats/watchtime` every ten seconds for the first half minute and every forty after, on every pause, and a final one when the song ends or is skipped. Each carries the stretches listened to since the last (`st` and `et`, so a seek does not count the skipped part), the position (`cmt`) and whether it is playing. Every report about one play shares a random 16-character nonce (`cpn`).
- **The cookie.** youtubei.js signs only InnerTube calls, so a stats request sent through it goes out anonymous. The engine sends them itself, with the session cookie, to `music.youtube.com` rather than the `s.youtube.com` host YouTube hands out, as the web player does.

The listening is tracked in `useWatchHistory`, from mpv's position updates: steady updates extend a stretch, and a jump or a pause starts a new one (`Listened` in `packages/core`).
