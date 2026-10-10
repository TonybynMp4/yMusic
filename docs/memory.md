# Memory

How much memory yMusic uses, where it goes, and how to measure a change to it.

## Where it goes

The app is three processes on Linux:

- The core, `ymusic`: Rust, libmpv and its demuxer cache, the pooled HTTP client, SQLite, the image cache's scheme handler, MPRIS.
- `WebKitWebProcess`: the React page, the engine worker (youtubei.js and everything it parses) and the BotGuard frame.
- `WebKitNetworkProcess`: small, a few MB.

v0.3.0, after 4.5 hours of playback, held 603 MB in RAM and 158 MB in swap across the three. The core held 279 MB (peak 357 MB, 52 threads) and the web process 321 MB (peak 647 MB). Use was flat over the last minutes measured, so this is a plateau and not a leak that grows by the minute.

In the core, most of it was glibc malloc fragmentation. glibc gives each thread that allocates its own arena, up to eight per core, and frees memory back to the arena rather than to the system. 63 arenas held 281 MB of anonymous memory between them. In the web process, the larger parts were the browse page cache, which never evicts, youtubei.js parsing YouTube's player script, and the BotGuard frame with its decipher code staying resident.

## Measuring

`scripts/memory` runs the same session against two builds and compares them. Run it on Linux:

```sh
node scripts/memory/run.mjs main --runs 3                     # before
node scripts/memory/run.mjs my-branch --runs 3                # after, on the branch
node scripts/memory/compare.mjs main my-branch --out docs/memory/my-branch --title "..."
```

`run.mjs` builds the app with `tauri build --no-bundle`, so the numbers are a release build's. `pnpm app` would measure Vite's unbundled modules and React's development checks instead. The build has three differences from a release:

- The identifier is `dev.tony.ymusic.memory` (`src-tauri/tauri.memory.conf.json`). The single-instance lock and the data and cache directories follow it, so a run works while yMusic is open and never touches its library or session. Each run deletes that identifier's directories first and starts signed out unless it is a `--variant signed-in` run.
- `VITE_MEMORY_SCENARIO` is set, which includes `src/memoryScenario.ts`. Without the flag the import is dead code and the bundle leaves it out.
- The core has the `memory-scenario` feature, which adds one command, `memory_mark`. The scenario calls it at each phase, the core prints the phase on stdout for the runner, and `done` quits the app. The feature also files the session key in the keyring as `ymusic-memory` rather than `ymusic`: the keyring does not follow the identifier, and signing out of a shared entry would sign the installed app out. For the same reason it registers its media session on D-Bus as `ymusic_memory`, so the installed app keeps its media keys during a run.
- Signed in, it reports no plays to the account's history and does not replace the account's queue (`OFF_THE_RECORD` in `usePlayer.ts`), so test songs do not land on a real account. The requests those make are left out of the measurement; they are a few small ones per song.

The scenario uses the app's own navigation and player, signed out unless `--variant signed-in`, with playback muted:

1. 60 s idle after launch.
2. 30 pages, 5 s each: ten artists, one album of each, and ten playlists.
3. A 1,003-track playlist, until every row has arrived.
4. 20 songs from a 948-track playlist. Each plays for 10 s, then seeks to 5 s before its end, so every change to the next song is a real one.
5. 120 s idle.

A run takes about 11 minutes. `--variant fallback` builds a version that resolves every stream through the PO-token client, to measure BotGuard and the decipher code. `--variant signed-in` runs the normal build with a saved session, which loads the library and a personal home page. Save one first with `node scripts/memory/run.mjs --sign-in`: it opens the app, waits for you to sign in, and keeps the sealed session in `.memory/account.bin` to put back before each run. The scenario marks whether the session loaded after the first idle minute, and the report flags a signed-in run that started signed out. The runner samples `/proc/<pid>/smaps_rollup` and `/proc/<pid>/status` for the core and its WebKit children every 2 s, and writes one JSON per run to `.memory/runs/<label>/`, which git ignores. `node scripts/memory/sample.mjs [pid]` prints the same numbers for an app already running, for checking real use.

`compare.mjs` writes three files to `--out`. `timeline.svg` plots each process over the session, median of the runs as a line and the lowest to highest run as shading. `report.md` has the tables: end-of-run memory (mean over the last 60 s), peak and threads per process, all processes at the end of each phase, and the change. A change smaller than the spread between the before runs is marked as within noise. `summary.json` holds the same numbers. For `--variant fallback` or `signed-in`, each name gets the variant as a suffix, such as `report-fallback.md`.

The numbers that matter are PSS (each process's share of the pages it maps, so shared libraries are not counted three times) plus swap. Swap depends on how much else the machine is doing, so each run records the free memory and swap it started with.

### Keeping comparisons fair

The scenario loads real pages from YouTube, and those change: a playlist gains songs, an artist page gains a shelf. Measure the before and the after on the same day, one after the other, rather than against an old baseline. Close what you can before a run, since swap depends on other programs. `docs/memory/baseline/` is the first measurement of `main`, for the long view.
