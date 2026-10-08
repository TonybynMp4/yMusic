# Interactions

An interaction is what you can do with a song, album, playlist or artist. A right click and the dots button open the same menu, built in `Interactions.tsx` from one list per kind, in YouTube Music's order. A collection's page loads when its menu opens, through the same cache that opening the page uses, so the menu knows the saved or subscribed state and has the tracks to queue. Actions that need every row of a long playlist wait for the rest to arrive.

YouTube Music's own buttons name what to call:

- *Start mix* on an album or playlist plays the radio playlist `RDAMPL` + its playlist id. An album's playlist id (`OLAK5uy_…`) is the one on its header's play button. An artist's mix is the header's own `RDEM…` playlist.
- *Save to library* likes the playlist id, the album's `OLAK5uy_…` one included. The header's bookmark toggle says whether it is saved. Your own playlists have no toggle, so they get no item.
- *Save to playlist* lists the playlists `playlist/get_add_to_playlist` offers, which are the ones you can edit.
- *New playlist*, at the end of that list, opens a dialog for a title, a description and who can see it, and creates the playlist with the songs in it. The new playlist button beside the sidebar's Library heading opens the same dialog for an empty playlist, next to the buttons that add a music folder and rescan the folders.
- Signed out, anything that writes to the account is hidden.

Local files have their own items. A folder's menu opens it in the file manager, and a local song's shows its file there, selected (the `FileManager1` D-Bus interface on Linux, Explorer on Windows). The Rust commands take a library folder or a track id, never a raw path, so the webview cannot open arbitrary files.

The player bar and the full player show the song's byline as YouTube Music's bar does: artists, album and release year. The title opens the album, as do the album's name and each artist with a channel. Following one of these links collapses the full player.

The year comes with a song from an album page (the header's subtitle), from an up-next panel (radio, mix, the resumed queue, where youtubei.js reads it off the byline's last run) and from a local file's tags. A YouTube song from a search or a playlist has none, so `useSongYear` asks for it with a plain `/next` for that song and reads its own panel row. The answer is kept for the session (a failed lookup is not, and is tried again the next time the song shows), and a song with no album on YouTube, such as a music video, shows no year.

## Liking and disliking

The thumbs down and up sit beside the song in the player bar and under the artwork in the full player, for a YouTube song while signed in. Pressing the one already on clears it. Liking a song adds it to Liked Music, which is YouTube's doing, not the app's.

A song's menu has the same two, as "Add to liked songs" and "Dislike", for any YouTube song while signed in. They show the rating as last seen: a song liked elsewhere and never played here reads as unrated until it plays. Liking it again does no harm. Disliking the song playing from its menu skips it, as the player bar does.

A disliked song's row is dimmed in lists and in the queue, as YouTube Music does, except while it is the song playing. On a list row the cover, title and artists fade, but the play button over the cover stays clear.

A song's rating costs no request of its own. Every signed-in play already sends a YouTube Music `/next` to share the queue for Resume, and its answer carries the like button, which `setServerQueue` reads. Signed in, it is a view model under `playerOverlays.playerOverlayRenderer.videoActionBar` (`...likeButtonViewModel.likeStatusEntity.likeStatus`). Signed out, it is the older `actions[].likeButtonRenderer.likeStatus`, always `INDIFFERENT`, so the live test only pins the signed-out shape. `useRatings` keeps the likes and dislikes seen in `localStorage`, for the signed-in account only and up to 5,000 songs, so they survive a restart. Setting a rating posts to `like/like`, `like/dislike` or `like/removelike` through the YouTube Music client. youtubei.js's `interact.like` sends the TV client, and a web session's cookie on another client is the mismatch YouTube flags. The buttons change at once and go back if YouTube refuses.

The Liked Music playlist would say which songs are liked, but not which are disliked (YouTube has no list of those), and reading all of it is a request per hundred songs. The rating read with each play covers both for nothing.

Disliking the song playing skips it, as YouTube Music does. With "Skip disliked songs" on, a disliked song is also skipped when it comes up in the queue: at the end of the one before, or on Next. One you pick yourself plays, and so does one where skipping would not move to a different song, such as the last in the queue or one on repeat. A queue of only disliked songs on repeat stops skipping after one pass and plays. A song already known as disliked is passed over before it loads. One disliked on another device since it last played here is only found out once it starts, and is skipped then.
