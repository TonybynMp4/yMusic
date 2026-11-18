# Replay

The app can run in a plain browser from a recording, with no Rust core, no account and no network. This is how an agent test-drives a change and takes before and after screenshots without ever holding a session cookie.

## Recording

```sh
pnpm --filter @ymusic/desktop record            # the real app, signed in as whoever is signed in
pnpm --filter @ymusic/desktop record:browser    # a plain browser, signed out
```

`record` runs `tauri dev` with `YMUSIC_RECORD=default`. Open the screens a change might touch (home, the library, a playlist, an album, an artist, search, settings), then quit. The terminal prints one line per call. Recording again replaces the cassette, so record a fresh one whenever YouTube changes its answers or a screen needs data the cassette lacks.

`record:browser` needs no app and no account, so an agent can run it alone. The dev server sends YouTube's requests from Node instead of `http_fetch`, and only those are recorded. The cassette is called `signed-out`.

Set `YMUSIC_RECORD` to another name to keep several cassettes. A name is a folder under `$XDG_DATA_HOME/ymusic-dev/cassettes` (`~/.local/share/ymusic-dev/cassettes`), outside the repo, so every worktree on the machine sees the same cassettes. An absolute path is used as it is.

## Replaying

```sh
pnpm --filter @ymusic/desktop dev:replay                     # the default cassette
YMUSIC_REPLAY=signed-out pnpm --filter @ymusic/desktop dev:replay
```

Then open `http://localhost:1420` in a browser. In the T3 preview browser, use the incognito profile: the default profile's cookies for `localhost` are larger than Vite accepts (HTTP 431). The app has no URL routes, so moving around means clicking. Going back in the browser leaves the app.

For a before and after pair, replay the same cassette on `main` and on the branch. The data is the same in both, so any difference between the shots comes from the change.

A YouTube request that was never recorded fails the way an offline request does. The dev server's terminal prints it once (`[replay] not recorded: POST www.youtube.com/youtubei/v1/search {"query":"justice",...}`), and the page keeps every miss in `window.__replayMisses`. A screen that shows an error after a miss needs a new recording, not a fix.

## How it works

Every call the app makes into Rust goes through `window.__TAURI_INTERNALS__.invoke`, and every request to YouTube is one of those calls (`http_fetch`, see [The data engine](engine.md)). So one point covers both.

- `src/replay/vite.ts` is a Vite plugin, active only under `vite dev` and only when `YMUSIC_RECORD` or `YMUSIC_REPLAY` is set. It puts `record.ts` or `replay.ts` in `index.html` ahead of `main.tsx`, and serves `/__replay/*`: storing entries, sending signed-out requests, serving the cassette and logging misses.
- `src/replay/internals.ts` gives a plain browser Tauri's mock IPC before anything reads it. `@ymusic/ipc` decides `isTauri` once, when first evaluated, so this has to be the first import of both entries. With the mock in place the app takes its in-app paths: the account menu, the settings page and artwork through the `img` scheme, which the mock turns back into the plain Google URL.
- `src/replay/record.ts` wraps `invoke` and posts each call and its answer to the dev server.
- `src/replay/replay.ts` answers `invoke` from the cassette.

### The cassette

One JSON file per call, numbered in the order the calls finished, so YouTube's answers and the core's sit on one timeline. A JSON body is stored parsed (`http.json`), so a re-recording reads as a diff.

Nothing that can sign in is written. Request headers are dropped, `Set-Cookie` is dropped from responses, and a command that returns the session (`account_cookie`, `account_import` and the rest) keeps the cookie names with every value replaced by `replay`. The names are enough for the engine to treat the session as signed in, and the recorded answers say `logged_in`, so nothing signs out. The answers themselves are not scrubbed: a cassette recorded signed in holds that account's name, avatar, library and history. Keep it out of the repo, or record it from an account made for the purpose.

### Matching

A YouTube request matches on its method, host, path, query and body, less what changes between runs without changing the answer: the client `context` (versions, visitor data), playback nonces and tokens, click tracking, and the `key`, `t`, `cpn`, `prettyPrint` and `alt` parameters. A body that is not JSON matches on its length. Continuation tokens come from recorded answers, so paging matches as it was recorded.

A Rust command matches on its name and arguments. A `Channel` serializes with an id that differs each run, which is dropped.

When the same key was recorded more than once (a playlist loaded, edited, loaded again), replay moves to the next answer only once something recorded between the two has been replayed. A page opened after a replayed edit shows the edit; refetching it before the edit does not.

### What a browser answers on its own

A Rust command not in the cassette gets an empty answer of the right shape, as a fresh install would give (`browser.ts`): no local files, no audio devices, the default volume, an empty saved queue. Commands that only tell the core something get null. Settings live in the tab, starting from the recorded ones, so a toggle on the settings page holds until a reload.

## Limits

- No sound. mpv is in the core, and stream URLs expire within hours. The player's events (status, position) arrive on a `Channel`, which replay does not record yet, so a track that starts in a replay shows as loading.
- Writes don't change state unless the recording has the read that followed them, as above.
- Thumbnails load live from Google's image hosts, which need no session. A thumbnail YouTube has since replaced shows the new one.
- Title bar controls, Mica and other native chrome exist only in the app.
