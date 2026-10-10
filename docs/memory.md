# Memory

How much memory yMusic uses, where it goes, and what has been cut.

## Where it goes

The app is three processes on Linux:

- The core, `ymusic`: Rust, libmpv and its demuxer cache, the pooled HTTP client, SQLite, the image cache's scheme handler, MPRIS.
- `WebKitWebProcess`: the React page, the engine worker (youtubei.js and everything it parses) and the BotGuard frame.
- `WebKitNetworkProcess`: small, a few MB.

v0.3.0, after 4.5 hours of playback, held 603 MB in RAM and 158 MB in swap across the three. The core held 279 MB (peak 357 MB, 52 threads) and the web process 321 MB (peak 647 MB). Use was flat over the last minutes measured, so this is a plateau and not a leak that grows by the minute.

In the core, most of it was glibc malloc fragmentation. glibc gives each thread that allocates its own arena, up to eight per core, and frees memory back to the arena rather than to the system. 63 arenas held 281 MB of anonymous memory between them. In the web process, the larger parts were the browse page cache, which never evicts, youtubei.js parsing YouTube's player script, and the BotGuard frame with its decipher code staying resident.

## What has been cut

Each change has its before and after in `docs/memory/<change>/`.

### glibc arenas in the core

`main.rs` caps glibc at two malloc arenas with `mallopt(M_ARENA_MAX, 2)`, before any thread starts, and sets `MALLOC_ARENA_MAX=2` for WebKit's processes. Every child inherits that variable, so an app opened through `xdg-open` gets two arenas as well. If the user already set a limit through `MALLOC_ARENA_MAX` or `GLIBC_TUNABLES`, the app changes nothing, in the core or its children. When mpv starts the next file, the playback event thread calls `malloc_trim(0)`, which hands back what the last song's buffers freed. glibc only returns memory at the top of the heap on its own.

The core now ends the scenario 64 MB lower signed out and 70 MB lower signed in, about a quarter less, and its peak RSS is 54 to 66 MB lower (`docs/memory/glibc-arenas/`). Two arenas did not cost anything visible: the thread count is the same and playback did not stall more.

The web process did not measurably change. It ends near 380 MB or near 550 MB, in both builds, depending on whether JavaScriptCore releases what the long playlist used before the end of the run. Totals across processes swing with it, so compare the core on its own for this change.

## Measuring

The numbers come from a harness that runs a scripted 11 minute session against two release builds and samples each process from `/proc`. It is not merged: it adds hooks to the app (a scenario module, a core feature and a command), and it lives on the `chore/memory-harness` branch ([#49](https://github.com/TonybynMp4/yMusic/pull/49)), with its own guide in this file there. To measure a branch, rebase the harness onto it.
