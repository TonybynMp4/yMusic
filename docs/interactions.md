# Interactions

An interaction is what you can do with a song, album, playlist or artist. A right click and the dots button open the same menu, built in `Interactions.tsx` from one list per kind, in YouTube Music's order. A collection's page loads when its menu opens, through the same cache that opening the page uses, so the menu knows the saved or subscribed state and has the tracks to queue. Actions that need every row of a long playlist wait for the rest to arrive.

YouTube Music's own buttons name what to call:

- *Start mix* on an album or playlist plays the radio playlist `RDAMPL` + its playlist id. An album's playlist id (`OLAK5uy_…`) is the one on its header's play button. An artist's mix is the header's own `RDEM…` playlist.
- *Save to library* likes the playlist id, the album's `OLAK5uy_…` one included. The header's bookmark toggle says whether it is saved. Your own playlists have no toggle, so they get no item.
- *Save to playlist* lists the playlists `playlist/get_add_to_playlist` offers, which are the ones you can edit.
- *New playlist*, at the end of that list, opens a dialog for a title, a description and who can see it, creates the playlist with the songs in it and opens its page. Right after the create, YouTube can answer the playlist with an empty page, so the page is fetched afresh and retried for a few seconds until it has its title and songs. YouTube's library can take a while to list a new playlist, so the sidebar shows it from the id `playlist/create` returns, and fetches the list again (five times at most, over about half a minute) until YouTube's entry, with its art, replaces it. The new playlist button beside the sidebar's Library heading opens the same dialog for an empty playlist, next to the buttons that add a music folder and refresh the library. Refresh fetches the playlists again and rescans the music folders.
- Signed out, anything that writes to the account is hidden.

Local files have their own items. A folder's menu opens it in the file manager, and a local song's shows its file there, selected (the `FileManager1` D-Bus interface on Linux, Explorer on Windows). The Rust commands take a library folder or a track id, never a raw path, so the webview cannot open arbitrary files.

The player bar and the full player show the song's byline as YouTube Music's bar does: artists, album and release year. The title opens the album, as do the album's name and each artist with a channel. Following one of these links collapses the full player. The full player covers the page only: the sidebar and the bar with search and the account menu stay, as in YouTube Music. Back, the mouse's back button, Alt+Left, Escape or the arrow on the player bar close it and leave you on the page under it.

The year comes with a song from an album page (the header's subtitle), from an up-next panel (radio, mix, the resumed queue, where youtubei.js reads it off the byline's last run) and from a local file's tags. A YouTube song from a search or a playlist has none, so `useSongYear` asks for it with a plain `/next` for that song and reads its own panel row. The answer is kept for the session (a failed lookup is not, and is tried again the next time the song shows), and a song with no album on YouTube, such as a music video, shows no year.

## Your playlists

A playlist's page shows its owner, its summary line, who can see it (your own playlists only: YouTube says so on the edit form alone), a second line with the song count and total length, and the description. Until every row has loaded, the count and length are YouTube's; after, they come from the rows, so they follow your edits.

On your own playlist the page has an Edit button beside Play and Shuffle, and the playlist's menu has "Edit playlist" and "Delete playlist". Edit opens YouTube Music's dialog, the New playlist one filled in, and sends only what changed. Delete asks first, since YouTube cannot bring a playlist back, then takes it out of the sidebar and out of history, so Back never lands on it, and leaves its page if you are on it.

Each row has "Remove from playlist" in its menu, and rows reorder by dragging, with the same drag the queue uses (`useRowDrag.ts`). Rows move and go only once all of them have loaded, because the queue follows a loading playlist by how many rows it has. A row is named by its own id within the playlist (YouTube's `setVideoId`), since a song can be in a playlist twice. youtubei.js drops that id, so it is read from the row's "Remove from playlist" menu item, which only your own playlists have, as ytmusicapi does. That same edit form on the header is what marks a playlist as yours.

Every change shows at once and goes to YouTube after. If YouTube refuses it, the page is fetched again so it shows what YouTube has. The changes are what YouTube Music's web player sends (`packages/youtube/src/edit.ts`): a list of actions to `browse/edit_playlist` (`ACTION_SET_PLAYLIST_NAME`, `ACTION_SET_PLAYLIST_DESCRIPTION`, `ACTION_SET_PLAYLIST_PRIVACY`, `ACTION_REMOVE_VIDEO`, and `ACTION_MOVE_VIDEO_BEFORE` naming the row that ends up after the moved one, or none to move it last), and `playlist/delete`. Both go through the YouTube Music client, as rating does.

## Liking and disliking

The thumbs down and up sit beside the song in the player bar and under the artwork in the full player, for a YouTube song while signed in. Pressing the one already on clears it. Liking a song adds it to Liked Music, which is YouTube's doing, not the app's.

A song's menu has the same two, as "Add to liked songs" and "Dislike", for any YouTube song while signed in. They show the rating as last seen: a song liked elsewhere and never played here reads as unrated until it plays. Liking it again does no harm. Disliking the song playing from its menu skips it, as the player bar does.

A disliked song's row is dimmed in lists and in the queue, as YouTube Music does, except while it is the song playing. On a list row the cover, title and artists fade, but the play button over the cover stays clear.

A song's rating costs no request of its own. Every signed-in play already sends a YouTube Music `/next` to share the queue for Resume, and its answer carries the like button, which `setServerQueue` reads. Signed in, it is a view model under `playerOverlays.playerOverlayRenderer.videoActionBar` (`...likeButtonViewModel.likeStatusEntity.likeStatus`). Signed out, it is the older `actions[].likeButtonRenderer.likeStatus`, always `INDIFFERENT`, so the live test only pins the signed-out shape. `useRatings` keeps the likes and dislikes seen in `localStorage`, for the signed-in account only and up to 5,000 songs, so they survive a restart. Setting a rating posts to `like/like`, `like/dislike` or `like/removelike` through the YouTube Music client. youtubei.js's `interact.like` sends the TV client, and a web session's cookie on another client is the mismatch YouTube flags. The buttons change at once and go back if YouTube refuses.

The Liked Music playlist would say which songs are liked, but not which are disliked (YouTube has no list of those), and reading all of it is a request per hundred songs. The rating read with each play covers both for nothing.

Disliking the song playing skips it, as YouTube Music does. With "Skip disliked songs" on, a disliked song is also skipped when it comes up in the queue: at the end of the one before, or on Next. One you pick yourself plays, and so does one where skipping would not move to a different song, such as the last in the queue or one on repeat. A queue of only disliked songs on repeat stops skipping after one pass and plays. A song already known as disliked is passed over before it loads. One disliked on another device since it last played here is only found out once it starts, and is skipped then.
