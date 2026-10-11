# Memory

How much memory yMusic uses, where it goes, and how to measure a change to it.

## Where it goes

The app is three processes on Linux:

- The core, `ymusic`: Rust, libmpv and its demuxer cache, the pooled HTTP client, SQLite, the image cache's scheme handler, MPRIS.
- `WebKitWebProcess`: the React page, the engine worker (youtubei.js and everything it parses) and the BotGuard frame.
- `WebKitNetworkProcess`: small, a few MB.

v0.3.0, after 4.5 hours of playback, held 603 MB in RAM and 158 MB in swap across the three. The core held 279 MB (peak 357 MB, 52 threads) and the web process 321 MB (peak 647 MB). Use was flat over the last minutes measured, so this is a plateau and not a leak that grows by the minute.

In the core, most of it was glibc malloc fragmentation. glibc gives each thread that allocates its own arena, up to eight per core, and frees memory back to the arena rather than to the system. 63 arenas held 281 MB of anonymous memory between them. In the web process, the suspects were the browse page cache, which never evicted, youtubei.js parsing YouTube's player script, and the BotGuard frame with its decipher code staying resident. The page cache turned out to be small and the player script large (below).

## What has been cut

Each change has its before and after in `docs/memory/<change>/`.

### glibc arenas in the core

`main.rs` caps glibc at two malloc arenas with `mallopt(M_ARENA_MAX, 2)`, before any thread starts, and sets `MALLOC_ARENA_MAX=2` for WebKit's processes. Every child inherits that variable, so an app opened through `xdg-open` gets two arenas as well. If the user already set a limit through `MALLOC_ARENA_MAX` or `GLIBC_TUNABLES`, the app changes nothing, in the core or its children. When mpv starts the next file, the playback event thread calls `malloc_trim(0)`, which hands back what the last song's buffers freed. glibc only returns memory at the top of the heap on its own.

The core now ends the scenario 54 MB lower signed out and 67 MB lower signed in, about a third of its anonymous memory, and its peak RSS is 54 to 60 MB lower (`docs/memory/glibc-arenas/`). Two arenas did not cost anything visible: the thread count is the same and playback did not stall more.

The web process did not measurably change. It ends near 330 MB or near 480 to 570 MB, in both builds, depending on whether JavaScriptCore releases what the long playlist used before the end of the run. Totals across processes swing with it, so compare the core on its own for this change.

### The browse page cache

`useBrowse.ts` keeps the 10 most recently opened pages and drops the oldest past that. A page on screen, followed by the queue, or still loading is never dropped. Going back to a dropped page fetches it again, and `App.tsx` reapplies the saved scroll offset as the page grows back, until it reaches the offset or you scroll.

The cache was smaller than it looked. Parsed in Node, the scenario's 30 artist, album and playlist pages come to 1.3 MB as JSON and its two thousand-row playlists to 1 MB, so the 20 pages the cap drops held one to three megabytes, and each page opened past ten adds roughly 50 to 150 KB. That is too small to show against the run-to-run spread (`docs/memory/browse-lru/`): the core ends within noise of the build before and the web process's peak does not move. The cap is there so an evening of browsing cannot grow without end, not for a saving the scenario can see.

The same runs show where the web process's big swings come from. Signed out, the build before ended at 314 to 566 MB of anonymous memory and this change's at 302 to 313 MB. Signed in it went the other way: 326 to 332 MB before, 442 to 486 MB after. The peaks are the same in both builds, about 490 to 520 MB, so the end of a run only shows whether JavaScriptCore had released what the long playlist used yet.

### The player script on `VISIONOS`

`createPlayer` in `client.ts` now passes `retrieve_player: false`, like the search client. youtubei.js no longer downloads and interprets YouTube's player JavaScript to resolve a stream, which it did once per engine worker and then kept. `VISIONOS` formats carry a plain URL with no signature cipher and no `n` parameter, so the URL is the same either way. The play reports still need the player script's signature timestamp, and `fetchSignatureTimestamp` reads that one number from the script's text without running it, cached for 12 hours. The PO-token fallback still interprets the script, because its `TV_SIMPLY` URLs do need deciphering.

The web process no longer climbs during the first song (`docs/memory/no-player-script/`). Signed out, its peak anonymous memory drops from 522 to 320 MB and it ends 45 MB lower. Signed in, the app resolves a stream within its first minute, so before this change the script was parsed before any browsing: all processes held 471 MB at the end of the first idle minute and now hold 193 MB. The peak across processes is 42 MB lower. The signed-in end of run is 65 MB lower, but the web process's runs overlap, so that part is within noise. The fallback variant resolves every stream through the PO-token client, which still parses the script, and its web process is unchanged.

### The fallback path

youtubei.js hands the fallback's decipher code over with a call appended that has the URL's `n` and signature written into it, so the source was new for every URL and JavaScriptCore compiled the whole extract again each time. `installEvaluator` in `client.ts` now compiles the part before that call once per player script, keeps only the latest, and passes the values in. `botguard.ts` removes the BotGuard frame after five minutes with no calls, which frees its VM and the challenge it ran. The minter goes with the frame, so `PoTokenMinter.mint` builds a new one and tries once more when a mint fails.

The scenario cannot see either change (`docs/memory/fallback-resident/`). Every number in the fallback variant ends within noise of the build before. The frame only closes after five idle minutes and the scenario's last idle phase lasts two, so the runs never reach it. Each compiled extract used to be garbage once its call returned, so caching saves compile time, not memory. It does keep one compiled extract in the engine worker until the next player script replaces it, on purpose: that is not a leak. The change is for a fallback session that plays a few songs and then sits for hours with BotGuard loaded.

### Small maps

Two maps in the page only grew. `usePlayer.ts` keeps a stream lease per resolved song so going back to it skips a request, and now drops the expired ones each time it stores a new lease; a lease lasts a few hours, so a long session no longer keeps one per song it ever played. `useSongYear.ts` caches each song's release year for the session and now keeps the latest 500.

Each entry is a few hundred bytes, so the scenario cannot see the change (`docs/memory/small-maps/`): every web and total number ends within noise of the build before. Signed in, the core reads 6 MB higher, but this change does not touch the core, and the before runs were so close together (121 MB each) that any difference clears the noise line. This is about a session that runs for days, not a saving an 11 minute run shows.

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

The number that matters is anonymous memory (`Pss_Anon`: heaps, JIT code and buffers the process allocated itself) plus swap. PSS, each process's share of every page it maps, also counts shared libraries, and that share drops whenever another program maps the same libraries. Any other WebKitGTK app open during a run lowers every process's PSS by 20 to 30 MB without the app changing, so the report gives PSS only as a secondary table. Swap depends on how much else the machine is doing, so each run records the free memory and swap it started with.

### Keeping comparisons fair

The scenario loads real pages from YouTube, and those change: a playlist gains songs, an artist page gains a shelf. Measure the before and the after on the same day, one after the other, rather than against an old baseline. Close what you can before a run, since swap depends on other programs. `docs/memory/baseline/` is the first measurement of `main`, for the long view.
