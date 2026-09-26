# The data engine

`youtubei.js` runs in a **Web Worker**, so InnerTube parsing and BotGuard work stay off the UI thread. The worker is exposed over **Comlink**, which keeps the engine's TypeScript type across the boundary. Engine methods take and return only structured-cloneable values (ids, strings, `Track`s, leases). A youtubei.js continuation is a closure, so it stays in the worker under a handle.

- **CORS.** InnerTube rejects browser-origin requests. The worker has no Tauri IPC, so its `fetch` is serialised to the main thread and sent through `tauri-plugin-http` there, which makes the request in Rust.
- **Stream resolution.** `VISIONOS` first: it needs no token and no evaluator. On failure, or when mpv is refused a stream that resolved, the engine falls back to `TV_SIMPLY` with a PO token.
- **PO tokens.** Google's BotGuard VM mints them, and it needs a real DOM and `eval`. The worker has no DOM, and the app page has a strict CSP and IPC next to Google's code. So BotGuard runs in a hidden iframe on its own `botguard:` scheme, served by Rust with a CSP that allows eval and nothing else, reached only over a MessagePort. Tauri's init scripts, which carry the IPC key, reach the main frame only, and the frame checks this on every load.
- BotGuard's challenge is bound to the `Origin` it was requested from. None and `tauri://localhost` pass; YouTube's own origins and the dev server's are refused, so those requests go out with none.
