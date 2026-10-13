# Memory

How much memory yMusic uses, where it goes, and what has been cut.

## Where it goes

The app is three processes on Linux:

- The core, `ymusic`: Rust, libmpv and its demuxer cache, the pooled HTTP client, SQLite, the image cache's scheme handler, MPRIS.
- `WebKitWebProcess`: the React page, the engine worker (youtubei.js and everything it parses) and the BotGuard frame.
- `WebKitNetworkProcess`: small, a few MB.

v0.3.0, after 4.5 hours of playback, held 603 MB in RAM and 158 MB in swap across the three. The core held 279 MB (peak 357 MB, 52 threads) and the web process 321 MB (peak 647 MB). Use was flat over the last minutes measured, so this is a plateau and not a leak that grows by the minute.

In the core, most of it was glibc malloc fragmentation. glibc gives each thread that allocates its own arena, up to eight per core, and frees memory back to the arena rather than to the system. 63 arenas held 281 MB of anonymous memory between them. In the web process, the larger parts were the browse page cache, which never evicts, youtubei.js parsing YouTube's player script, and the BotGuard frame with its decipher code staying resident.

## Measuring

The numbers come from a harness that runs a scripted 11 minute session against two release builds and samples each process from `/proc`. It is not merged: it adds hooks to the app (a scenario module, a core feature and a command), and it lives on the `chore/memory-harness` branch ([#49](https://github.com/TonybynMp4/yMusic/pull/49)), with its own guide in this file there. To measure a branch, rebase the harness onto it.
