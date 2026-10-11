# Memory

How much memory yMusic uses, where it goes, and what has been cut.

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

## Measuring

The numbers come from a harness that runs a scripted 11 minute session against two release builds and samples each process from `/proc`. It is not merged: it adds hooks to the app (a scenario module, a core feature and a command), and it lives on the `chore/memory-harness` branch ([#49](https://github.com/TonybynMp4/yMusic/pull/49)), with its own guide in this file there. To measure a branch, rebase the harness onto it.
