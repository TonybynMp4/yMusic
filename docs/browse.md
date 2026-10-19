# Browse pages and long lists

Album, artist and playlist pages load through `useBrowse.ts`, which keeps the pages opened this run, so going back is instant and a long playlist keeps loading while you look at something else. A page that failed to open is fetched again the next time it is opened.

## The cache

Pages live in the app's TanStack Query client (`query.ts`), one query per page under `["browse", kind, id]`, and each query calls the engine worker. The queue and the menus read the same queries from outside React (`browseState`, `followPlaylist`, `settledPage`), so a page is fetched once whoever asks for it.

- **Fresh for the run.** A page fetched this run is not fetched again unless something marks it stale: saving to a playlist, editing one, or Refresh (`refreshPage`). A stale page keeps showing while its new copy loads, and only a page on screen or followed by the queue refetches at once; any other waits for the next look.
- **Ten pages.** The cache keeps the 10 most recently opened pages (`capQueries` in `query.ts`, see [Memory](memory.md#the-browse-page-cache)). Query's own garbage collection is by time, so it is off for pages (`gcTime: Infinity`) and the cap counts instead.
- **A seam for a persister.** Data stamped before this run started counts as stale, so a page a persister restores shows at once and is fetched again in the background. That is how the SQLite page cache in [the plan](../PLAN.md) would plug in: restore into the client, and the rest already works.

## Long playlists

YouTube serves a playlist a hundred rows at a time, each page a round trip, so a liked-songs list of two thousand songs takes twenty requests. The engine returns the first page with a handle for the next (a youtubei.js continuation is a closure, so it stays in the worker), and the page shows as soon as the first hundred rows arrive.

A playlist is one query whose fetch streams: it writes the rows gathered so far into the cache as it goes, and settles when the last page lands or a page fails. `useInfiniteQuery` would render once per page, and its refetch rebuilds every page from the start, dropping edits made meanwhile and blanking the rows already shown. Search, which pages only when you scroll, does use it.

- **The first page** is tried twice, half a second apart, before the page shows an error. A long playlist's first request is the slow one, and one that timed out often works straight after.
- **The rest** arrives in the background. Rows are gathered and shown at most every 250 ms, and at once when the last page lands, rather than once per page: each showing re-renders the page and updates a queue playing the playlist.
- **A failed page** leaves the rows so far in place, and the end of the list says "Couldn't load the rest of this playlist" with a Retry button. Retry asks for the page that failed again: the engine drops a handle only once its page has arrived. If the handle is gone anyway (the engine keeps only the newest sixteen), Retry reloads the playlist from the start, and the rows already showing stay until as many have arrived again.
- **The queue** follows a playlist as it loads (`followPlaylist`), so playing a long playlist queues all of it. It stops following when loading stops, a failed page included, so rows a Retry brings in later are not added to a queue already playing.

## Track lists

`TrackList` renders rows of a fixed 48 px. From 60 rows on it is virtualized with `@tanstack/react-virtual` (`components/VirtualList.tsx`), with 25 rows drawn past each edge of the viewport, about two screenfuls, so a quick scroll lands on rows already drawn.

The main area, the queue and the sidebar scroll natively, with a thumb of our own drawn beside the scrolled element (`components/ui/scroll-area.tsx`). WebKitGTK's scrollbar vanished during a fast scroll, styled through CSS or not. Base UI's scroll area set CSS variables on the scrolled element on every scroll event, which restyled every row inside it. A fast scroll through 2000 songs drew about 7 frames a second with it and 20 or more without. The queue's rows are memoized and drawn 25 past the viewport, as playlist rows are. Rows are CSS-contained, so mounting one lays out only the list, and the virtualizer lets React schedule the render that adds rows instead of forcing it inside the scroll event.

- **Rows are memoized.** The list hands each row handlers that never change (they read the latest props when called) and only that row's own state: whether it is the current song, and whether it is playing. So more rows arriving re-renders no row already shown, a new current song re-renders only the old and new current rows, and play or pause re-renders only the current row.
- **Covers load eagerly.** A row only exists near the viewport, so the browser's `loading="lazy"` would only add WebKit's own deferral on top. Covers load through the `img` scheme (`src-tauri/src/images.rs`), which caches them on disk.
