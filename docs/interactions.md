# Interactions

An interaction is what you can do with a song, album, playlist or artist. A right click and the dots button open the same menu, built in `Interactions.tsx` from one list per kind, in YouTube Music's order. A collection's page loads when its menu opens, through the same cache that opening the page uses, so the menu knows the saved or subscribed state and has the tracks to queue. Actions that need every row of a long playlist wait for the rest to arrive.

YouTube Music's own buttons name what to call:

- *Start mix* on an album or playlist plays the radio playlist `RDAMPL` + its playlist id. An album's playlist id (`OLAK5uy_…`) is the one on its header's play button. An artist's mix is the header's own `RDEM…` playlist.
- *Save to library* likes the playlist id, the album's `OLAK5uy_…` one included. The header's bookmark toggle says whether it is saved. Your own playlists have no toggle, so they get no item.
- *Save to playlist* lists the playlists `playlist/get_add_to_playlist` offers, which are the ones you can edit.
- Signed out, anything that writes to the account is hidden.

Local files have their own items. A folder's menu opens it in the file manager, and a local song's shows its file there, selected (the `FileManager1` D-Bus interface on Linux, Explorer on Windows). The Rust commands take a library folder or a track id, never a raw path, so the webview cannot open arbitrary files.

## Liking and disliking

The thumbs down and up sit beside the song in the player bar and under the artwork in the full player, for a YouTube song while signed in. Pressing the one already on clears it. Liking a song adds it to Liked Music, which is YouTube's doing, not the app's.

`rating.ts` reads a song's rating from the like button in the player overlay of a YouTube Music `/next` call (`playerOverlays.playerOverlayRenderer.actions[].likeButtonRenderer.likeStatus`), once per song while it plays, and `useRating` keeps the answers until you sign out. Setting it posts to `like/like`, `like/dislike` or `like/removelike` through the YouTube Music client. youtubei.js's `interact.like` sends the TV client, and a web session's cookie on another client is the mismatch YouTube flags. The buttons change at once and go back if YouTube refuses.

Disliking the song playing skips it, as YouTube Music does. With "Skip disliked songs" on, a disliked song is also skipped when it comes up in the queue: at the end of the one before, or on Next. One you pick yourself plays. The rating is only known once the song has started, so a skipped song plays for as long as `/next` takes to answer.
