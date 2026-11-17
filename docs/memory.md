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

`useBrowse.ts` keeps the 10 most recently opened pages in the Query client and drops the least recently opened past that (`capQueries` in `query.ts`). A page on screen, followed by the queue, or still loading is never dropped. Going back to a dropped page fetches it again, and `App.tsx` reapplies the saved scroll offset as the page grows back, until it reaches the offset or you scroll.

The cache was smaller than it looked. Parsed in Node, the scenario's 30 artist, album and playlist pages come to 1.3 MB as JSON and its two thousand-row playlists to 1 MB, so the 20 pages the cap drops held one to three megabytes, and each page opened past ten adds roughly 50 to 150 KB. That is too small to show against the run-to-run spread (`docs/memory/browse-lru/`): the core ends within noise of the build before and the web process's peak does not move. The cap is there so an evening of browsing cannot grow without end, not for a saving the scenario can see.

The same runs show where the web process's big swings come from. Signed out, the build before ended at 314 to 566 MB of anonymous memory and this change's at 302 to 313 MB. Signed in it went the other way: 326 to 332 MB before, 442 to 486 MB after. The peaks are the same in both builds, about 490 to 520 MB, so the end of a run only shows whether JavaScriptCore had released what the long playlist used yet.

### The player script on `VISIONOS`

`createPlayer` in `client.ts` now passes `retrieve_player: false`, like the search client. youtubei.js no longer downloads and interprets YouTube's player JavaScript to resolve a stream, which it did once per engine worker and then kept. `VISIONOS` formats carry a plain URL with no signature cipher and no `n` parameter, so the URL is the same either way. The play reports still need the player script's signature timestamp, and `fetchSignatureTimestamp` reads that one number from the script's text without running it, cached for 12 hours. The PO-token fallback still interprets the script, because its `TV_SIMPLY` URLs do need deciphering.

The web process no longer climbs during the first song (`docs/memory/no-player-script/`). Signed out, its peak anonymous memory drops from 522 to 320 MB and it ends 45 MB lower. Signed in, the app resolves a stream within its first minute, so before this change the script was parsed before any browsing: all processes held 471 MB at the end of the first idle minute and now hold 193 MB. The peak across processes is 42 MB lower. The signed-in end of run is 65 MB lower, but the web process's runs overlap, so that part is within noise. The fallback variant resolves every stream through the PO-token client, which still parses the script, and its web process is unchanged.

### The fallback path

youtubei.js hands the fallback's decipher code over with a call appended that has the URL's `n` and signature written into it, so the source was new for every URL and JavaScriptCore compiled the whole extract again each time. `installEvaluator` in `client.ts` now compiles the part before that call once per player script, keeps only the latest, and passes the values in. `botguard.ts` removes the BotGuard frame after five minutes with no calls, which frees its VM and the challenge it ran. The minter goes with the frame, so `PoTokenMinter.mint` builds a new one and tries once more when a mint fails.

The scenario cannot see either change (`docs/memory/fallback-resident/`). Every number in the fallback variant ends within noise of the build before. The frame only closes after five idle minutes and the scenario's last idle phase lasts two, so the runs never reach it. Each compiled extract used to be garbage once its call returned, so caching saves compile time, not memory. It does keep one compiled extract in the engine worker until the next player script replaces it, on purpose: that is not a leak. The change is for a fallback session that plays a few songs and then sits for hours with BotGuard loaded.

### Small maps

Two maps in the page only grew. `usePlayer.ts` keeps a stream lease per resolved YouTube song so going back to it skips a request. Leases now live in the Query client (`leases.ts`), and each is dropped once unused for six hours, by which time it has expired, so a long session no longer keeps one per song it ever played. A local file's lease is not kept at all: it never expires, and resolving the file again only reads the disk. `useSongYear.ts` caches each song's release year for the session and now keeps the 500 looked up last, dropping the oldest first unless a song on screen still shows it.

Each entry is a few hundred bytes, so the scenario cannot see the change (`docs/memory/small-maps/`): every web and total number ends within noise of the build before. Signed in, the core reads 6 MB higher, but this change does not touch the core, and the before runs were so close together (121 MB each) that any difference clears the noise line. This is about a session that runs for days, not a saving an 11 minute run shows.

### WebKit's memory cache

wry leaves WebKitGTK on its default cache model, `WEB_BROWSER`, which keeps images, scripts and stylesheets in memory after no page uses them: up to 64 MB of them on any machine with 2 GB of RAM or more, with their decoded pixels kept for a minute (`calculateMemoryCacheSizes` in WebKit's `CacheModel.cpp`). Every thumbnail of every page opened stayed in the web process. `lib.rs` switches the model to `DOCUMENT_BROWSER` through `with_webview`, which caps what nothing shows at 24 MB and drops decoded pixels first, keeping the compressed bytes.

`DOCUMENT_VIEWER` keeps nothing nobody shows, and saves more: all processes held 40 MB less at the end of browsing and 52 MB less once the long playlist had loaded, with every run below every run of the build before (`docs/memory/cache-model/`, measured with that model). It made browsing worse, though. Going back to a page asked the `img` scheme for every thumbnail again, a round trip through the core and the disk cache, and artwork appeared a moment after the page did, where with the default it was already there. `DOCUMENT_BROWSER` keeps the recent pages' artwork in memory, so it draws with the page.

Measured against `main` with all of the stack before it merged (`docs/memory/cache-model-browser/`), `DOCUMENT_BROWSER` saves less than `DOCUMENT_VIEWER` and only while browsing. All processes held 17 MB less at the end of browsing, within noise, and 24 MB less once the long playlist had loaded. The web process's peak dropped 31 MB, from 349 to 318 MB, with every run below every run of the build before. By the end of the run the saving is gone: the web process ends 8 MB higher and all processes 10 MB higher, the second within noise. Playback and the idle minutes after it climb to the same level with either model, so the cap trims the browsing peak, not what a long session settles at.

In the `DOCUMENT_VIEWER` runs, the core's PSS rose 28 MB while the memory it holds did not move, so the rise is in shared pages (libraries and other mapped files), not memory the core allocated. PSS splits a shared page between the processes that have it resident, and which process gets charged shifts when another one stops touching those pages. The change does not touch the core, and with `DOCUMENT_BROWSER` the core's PSS ends within noise.

### The playback position

mpv reports `time-pos` many times a second, and the core used to send each one to the page over a Tauri channel. Each message runs as a script in the page and updates its state. Now the core sends the page the position only a few times a song: when mpv restarts playback (a song starts, or a seek lands, including one while paused), on a pause, and when the song ends. While a song plays, `MpvPlaybackEngine` in `packages/ipc` asks for it with the `player_position` command just after each whole second, so the time label still ticks on the second. A command's reply comes back over Tauri's `ipc://` protocol, not as a script. Rust code that watches playback, such as MPRIS, still gets every position.

The web process ends the scenario 81 MB lower, 199 MB against 280, and all processes 75 MB lower (`docs/memory/position-pull/`). The peak doesn't move: the gain is what the web process used to keep building up during playback and the last idle minutes. Its three runs also land within 5 MB of each other, where the build before spread over 42 MB.

Sending the positions once a second instead, still pushed, ended within noise of pulling. The pull leaves about four messages per song. A test that kept every push but sent each one as arguments to one fixed function, so WebKit had no new source to compile, still ended near 294 MB in the two runs that played. So compiling the scripts doesn't seem to be the main cost. The page's work for each message is a better guess, but neither test proves it.

Synced lyrics will need the position more often than once a second. They should estimate it in the page from the last position, the time it arrived (`performance.now()`) and whether the song is playing, not ask the core more often.

### The window hidden in the tray

With "Keep playing in the tray", closing the window hides it. The webview stays, because the queue, the engine worker and BotGuard live in the page and playback needs all three. What the page can drop is the work only a visible window needs.

`visibility.rs` is the one place that hides and shows the main window. `hide` is what closing does, and what startup does when libmpv fails and only an error dialog is left. `show` is behind the tray menu, a click on the tray icon, a second launch and MPRIS Raise. Both record the state in `WindowVisibility` and tell the page over a channel (`window_subscribe`), once per change. `show` tells the page before it shows the window, so the page has started on its first frame by then. A page that subscribes while the window is hidden, after a reload, is told at once. `visibilitychange` is not used: nobody has checked what WebKitGTK and WebView2 report for a hidden window.

In the page, `windowHidden` in `packages/ipc` is a store shaped for `useSyncExternalStore`, and `useWindowHidden` is the hook over it.

`MpvPlaybackEngine` asks for the position every ten seconds while hidden (`HIDDEN_POLL_MS`), where it asks every second otherwise. Nothing draws it then. What still reads it:

- The saved queue position. `useSavedQueue` saves when a position arrives, at most every ten seconds, so what it writes is never older than the request that brought it.
- Watch time, which `WatchTime` carries across the gap ([the data engine](engine.md)).
- Anything that acts on a pause or a song's end: the save and the watch report that go out then. Rust sends the position ahead of both, so they never read the polled one.
- The media keys that move playback: Next, Previous (which restarts the song past three seconds), a seek by an offset and a seek to a position. `useMediaSession` asks for a fresh position first (`syncPosition`). Callers that overlap share one request, and a reply that a status drops is asked for again.

A position request that fails is asked again at the next interval. One that finds nothing loaded stops the polling until a song plays.

When the window is shown, the engine asks once at once, playing or paused, so the bar is right when it is drawn.

#### Nothing drawn

While hidden, `App` returns `null` (`useTrayIdle`). It still runs every hook it calls, and those are what playback needs: `usePlayer`, `useMediaSession`, `useResume`, `useSavedQueue`, the watch history inside `usePlayer`. So the title bar, the sidebar, the open page, the full player and the player bar unmount, and with them their DOM, their decoded images and the queries they observed. Nothing playback needs is in that tree. BotGuard's frame is appended to `document.body` by `botguard.ts`, the engine worker is a module singleton, and ratings and the queue live in `usePlayer`.

What the window comes back with is the state `App` and its hooks hold: the history of views, the scroll offset of each (`scrolls`), the search box and its filter, the sidebar, and whether the full player is open. The offset is restored by the same layout effect that restores it on Back, which runs again when the new scroll area mounts. The search box loses focus without a blur event when it unmounts, so `App` clears `searchFocused` itself, or the recent searches would float over the page on return. The level Unmute goes back to is the player bar's, so the bar reports it to `App`, which hands it back when the bar mounts again. State inside the views is lost: an open menu or dialog and what was typed in it, the full player's tab, "Show all" on local search results, an expanded description.

Once the views have let go of their queries, `dropPageData` removes what only they read:

- Browse pages, through `clearBrowseCache`, apart from the page the window comes back on, so that page is not fetched again.
- The library lists (`saved`), unless the window comes back on the library.
- Search results nothing observes, and the playlists a song can be added to.

It keeps anything in use (`inUse` in `query.ts`), which covers a playlist the queue follows, a page still loading, and the search in the box, which `App` observes. It never touches stream leases, which the player reads, or song years, which are small and which the bar would ask for again at once. What was in use when the window hid is dropped once it is let go of: `dropPageDataWhileHidden` runs `dropPageData` again when one of these queries finishes loading or loses its last observer, so a long playlist still loading, or one the queue stops following, does not stay for the whole time in the tray. "Clear cache" in Settings calls `clearBrowseCache` with no argument, which also removes a page still loading. The browse cap (`capQueries`) is not what runs here: it only acts when a page is added, and it would keep ten.

How much this saves is not measured yet. The tray scenario of the harness below is what decides whether it stays.

## Measuring

The numbers come from a harness that runs a scripted 11 minute session against two release builds and samples each process from `/proc`. It is not merged: it adds hooks to the app (a scenario module, a core feature and a command), and it lives on the `chore/memory-harness` branch ([#49](https://github.com/TonybynMp4/yMusic/pull/49)), with its own guide in this file there. To measure a branch, rebase the harness onto it.
