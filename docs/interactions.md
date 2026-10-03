# Interactions

An interaction is what you can do with a song, album, playlist or artist. A right click and the dots button open the same menu, built in `Interactions.tsx` from one list per kind, in YouTube Music's order. A collection's page loads when its menu opens, through the same cache that opening the page uses, so the menu knows the saved or subscribed state and has the tracks to queue. Actions that need every row of a long playlist wait for the rest to arrive.

YouTube Music's own buttons name what to call:

- *Start mix* on an album or playlist plays the radio playlist `RDAMPL` + its playlist id. An album's playlist id (`OLAK5uy_…`) is the one on its header's play button. An artist's mix is the header's own `RDEM…` playlist.
- *Save to library* likes the playlist id, the album's `OLAK5uy_…` one included. The header's bookmark toggle says whether it is saved. Your own playlists have no toggle, so they get no item.
- *Save to playlist* lists the playlists `playlist/get_add_to_playlist` offers, which are the ones you can edit.
- Signed out, anything that writes to the account is hidden.

Local files have their own items. A folder's menu opens it in the file manager, and a local song's shows its file there, selected (the `FileManager1` D-Bus interface on Linux, Explorer on Windows). The Rust commands take a library folder or a track id, never a raw path, so the webview cannot open arbitrary files.

The player bar and the full player show the song's byline as YouTube Music's bar does: artists, album and release year. The title opens the album, as do the album's name and each artist with a channel. Following one of these links collapses the full player.

The year comes with a song from an album page (the header's subtitle), from an up-next panel (radio, mix, the resumed queue, where youtubei.js reads it off the byline's last run) and from a local file's tags. A YouTube song from a search or a playlist has none, so `useSongYear` asks for it with a plain `/next` for that song and reads its own panel row. The answer is kept for the session, and a song with no album on YouTube, such as a music video, shows no year.
