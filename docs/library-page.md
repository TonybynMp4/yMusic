# Library page

"Library" in the sidebar opens one page for everything saved, as YouTube Music's Library is (`Library.tsx`). The sidebar stays the quick list.

## Chips

- *Playlists*: the account's playlists (`FEmusic_liked_playlists`), with a "New playlist" tile in front. In YouTube's default order this is the sidebar's list, which stands in while the page loads its own.
- *Songs*: the account's saved songs (`FEmusic_liked_videos`), always a list, with Shuffle all. The first page shows at once and the rest arrives a page at a time, through the same continuation handles as a long playlist.
- *Albums*: the saved albums (`FEmusic_liked_albums`).
- *Artists*: the artists of the songs in the library (`FEmusic_library_corpus_track_artists`). YouTube Music opens these on a library-only page (`MPLAUC…`); the app strips the prefix and opens the artist's own page.
- *Local files*: "All local files", then each folder, with its cover image, song count and total length.

Signed out, only Local files is left, and the chip row is hidden. The chip chosen last comes back when signing in again.

The account's lists load when their chip is first opened and are kept for the run, per account and sort (`useSavedLibrary.ts`). Saving or removing anything, and Refresh, drops them so the next look fetches again; liking or unliking a song drops only Songs. A list on screen stays until its reload has every page. A failed load is forgotten when its chip is left, so opening it again retries.

## Sort and layout

The account's lists take the sorts YouTube offers for each, in its own words, as YouTube Music's sort menu does. Each list's menu (`MusicSortFilterButton`) names the sort in use, and each option carries a continuation that reloads the list in its order, after which the list pages on as usual. The app shows those options and remembers the one picked for each chip.

Local files sort by Recently added, Recently played or A to Z:

- *Recently added*: a folder counts as added when its newest file was first scanned (`added_at` in SQLite).
- *Recently played*: the device's own record (`recent.ts`). When a local file starts playing, the app notes "All local files" and its folders. Anything that has not played here follows, in added order. The record keeps the 5000 most recent entries.
- *A to Z*: by title, ignoring case and accents, with numbers in numeric order.

The layout is a grid or a list, for every chip but Songs, which is always a list. The chip, the sorts and the layout are saved in `localStorage`.

