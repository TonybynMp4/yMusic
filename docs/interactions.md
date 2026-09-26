# Interactions

An interaction is what you can do with a song, album, playlist or artist. A right click and the dots button open the same menu, built in `Interactions.tsx` from one list per kind, in YouTube Music's order. A collection's page loads when its menu opens, through the same cache that opening the page uses, so the menu knows the saved or subscribed state and has the tracks to queue. Actions that need every row of a long playlist wait for the rest to arrive.

YouTube Music's own buttons name what to call:

- *Start mix* on an album or playlist plays the radio playlist `RDAMPL` + its playlist id. An album's playlist id (`OLAK5uy_…`) is the one on its header's play button. An artist's mix is the header's own `RDEM…` playlist.
- *Save to library* likes the playlist id, the album's `OLAK5uy_…` one included. The header's bookmark toggle says whether it is saved. Your own playlists have no toggle, so they get no item.
- *Save to playlist* lists the playlists `playlist/get_add_to_playlist` offers, which are the ones you can edit.
- Signed out, anything that writes to the account is hidden.
