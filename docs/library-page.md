# Library page

"Library" in the sidebar opens one page for everything saved, as YouTube Music's Library is (`Library.tsx`). The sidebar stays the quick list.

## Chips

- *Playlists*: the sidebar's list, with Liked Music pinned first and a "New playlist" tile in front.
- *Songs*: the account's saved songs (`FEmusic_liked_videos`), always a list, with Shuffle all. The first page shows at once and the rest arrives a page at a time, through the same continuation handles as a long playlist.
- *Albums*: the saved albums (`FEmusic_liked_albums`).
- *Artists*: the artists of the songs in the library (`FEmusic_library_corpus_track_artists`). YouTube Music opens these on a library-only page (`MPLAUC…`); the app strips the prefix and opens the artist's own page.
- *Local files*: "All local files", then each folder, with its cover image, song count and total length.

Signed out, only Local files is left, and the chip row is hidden. The chip chosen last comes back when signing in again.

Songs, Albums and Artists load when their chip is first opened and are kept for the run, per account (`useSavedLibrary.ts`). Saving or removing anything, and Refresh, drops them so the next look fetches again. A failed load is forgotten when its chip is left, so opening it again retries.

## Sort and layout

The sort is Recently added, Recently played or A to Z, and the layout a grid or a list. Both, with the chip, are saved in `localStorage` and apply to every chip.

- *Recently added*: YouTube's own order, which is newest first. A local folder counts as added when its newest file was first scanned (`added_at` in SQLite).
- *Recently played*: YouTube keeps no last-played date the app can read for a saved album or playlist, so this is the device's own record (`recent.ts`). When a song starts playing, the app notes the song, its album, its artists, the playlist the queue came from, and for a local file "All local files" and its folders. Anything that has not played here follows, in added order. The record keeps the 5000 most recent entries.
- *A to Z*: by title, ignoring case and accents, with numbers in numeric order.
