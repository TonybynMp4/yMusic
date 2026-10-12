# Browse pages and long lists

Album, artist and playlist pages load through `useBrowse.ts`, which keeps every page opened this run, so going back is instant and a long playlist keeps loading while you look at something else. A page that failed to open is forgotten once you leave it, so opening it again retries.

## Long playlists

YouTube serves a playlist a hundred rows at a time, each page a round trip, so a liked-songs list of two thousand songs takes twenty requests. The engine returns the first page with a handle for the next (a youtubei.js continuation is a closure, so it stays in the worker), and the page shows as soon as the first hundred rows arrive.

- **The first page** is tried twice, half a second apart, before the page shows an error. A long playlist's first request is the slow one, and one that timed out often works straight after.
- **The rest** arrives in the background. Rows are gathered and shown at most every 250 ms, and at once when the last page lands, rather than once per page: each showing re-renders the page and updates a queue playing the playlist.
- **A failed page** leaves the rows so far in place, and the end of the list says "Couldn't load the rest of this playlist" with a Retry button. Retry asks for the page that failed again: the engine drops a handle only once its page has arrived. If the handle is gone anyway (the engine keeps only the newest sixteen), Retry reloads the playlist from the start, and the rows already showing stay until as many have arrived again.
- **The queue** follows a playlist as it loads (`followPlaylist`), so playing a long playlist queues all of it. It stops following when loading stops, a failed page included, so rows a Retry brings in later are not added to a queue already playing.

## Track lists

`TrackList` renders rows of a fixed 48 px. From 60 rows on it is virtualized with `@tanstack/react-virtual` (`components/VirtualList.tsx`), with 25 rows drawn past each edge of the viewport, about two screenfuls, so a quick scroll lands on rows already drawn.

- **Rows are memoized.** The list hands each row handlers that never change (they read the latest props when called) and only that row's own state: whether it is the current song, and whether it is playing. So more rows arriving re-renders no row already shown, a new current song re-renders only the old and new current rows, and play or pause re-renders only the current row.
- **Covers load eagerly.** A row only exists near the viewport, so the browser's `loading="lazy"` would only add WebKit's own deferral on top. Covers load through the `img` scheme (`src-tauri/src/images.rs`), which caches them on disk.
