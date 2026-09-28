# Architecture

**Tauri 2**: a Rust core and a React frontend in the system webview (WebView2 on Windows, WebKitGTK on Linux). The binary is a few MB and the same code runs on both targets.

The tradeoff: Tauri gives us HTML, not real WinUI controls. We make up for it with platform integration:

| | Windows | Linux |
|---|---|---|
| Webview | WebView2 (bootstrapper in the installer) | WebKitGTK 4.1 |
| Window chrome | Custom titlebar with snap-layout hit-testing, Mica via `window-vibrancy` | Custom titlebar as CSD, flat themed surface |
| Media controls | SMTC: volume flyout and media keys | MPRIS: GNOME/KDE media widgets and media keys |
| Secrets | Windows Credential Manager | Secret Service (gnome-keyring, KWallet) |

The colours are YouTube Music's own dark palette on both platforms, not the system theme, so the app reads as a companion to the service.

`souvlaki` covers SMTC and MPRIS behind one API, and `keyring` covers Credential Manager and Secret Service behind another. One code path each, two backends.

## Libraries and why each is here

- **zod** parses every InnerTube response at the engine boundary into a domain model, so a changed response becomes a clear error instead of an `undefined` three layers down. Also used for the Rust/TS payloads in `packages/ipc`. Types derive from schemas, never the reverse.
- **Comlink** for the worker, and later for the plugin sandbox, so the app has one worker-RPC mechanism.
- **tRPC** is not in the core. It recovers types lost across a network, and the worker and the UI are compiled together, so nothing is lost. It comes back for plugin backends, where there is a real process boundary (see [Plugins](../PLAN.md#plugins)).
- **shadcn/ui on Base UI** (not Radix), with Tailwind v4. Owned source, which a music player needs for its sliders, menus and virtualized lists. Icons come from `@tabler/icons-react`.
- **SQLite** (`rusqlite`) for the local library index.
- **T3 Env** (`@t3-oss/env-core`), once the app needs an environment value. Nothing does yet, and the repo has no `.env`. The first value brings in one `env.ts` that declares every variable with a zod schema, and code reads them from there, never from `import.meta.env` or `process.env` directly. Client-side values need the `VITE_` prefix, and anything bundled into the frontend is public, so secrets never go there. Build and test tooling (`vite.config.ts`, the `YMUSIC_NETWORK_TESTS` gate, the release scripts) can keep reading `process.env`.

## Monorepo layout

pnpm workspaces and Turborepo. TypeScript 7 (the native `tsc`) type-checks the workspace; Vite bundles the app.

- `packages/core`: pure TypeScript, no Tauri, no DOM. Domain models and zod schemas, the queue reducer, and the `PlaybackEngine` interface. Mobile can reuse it as is.
- `packages/youtube`: the data engine. The youtubei.js wrapper, the PO-token minter, and the Comlink API, split into `worker` and `host` entry points so the main bundle never imports youtubei.js.
- `packages/ipc`: typed, zod-validated wrappers over Tauri commands and channels. The only package that calls `invoke`.
- `apps/desktop`: the Tauri app. `src/` is the React frontend and its shadcn components. `src-tauri/` is the Rust core: mpv playback, the sealed session and sign-in window, the local library, the `img` scheme, media controls and window chrome. Platform differences live in `platform/`, one module per concern, rather than `#[cfg]`s scattered through features.
