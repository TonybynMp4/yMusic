# Tuned radios

"Create a mix" builds a tuned radio (YouTube Music's apps call it a mix) from up to 30 artists and songs and tunes it. The dialog opens from the button next to "New playlist" in the sidebar's Library header, or from "Create a mix" in a song's or an artist's menu, with that song or artist already picked. Signed in, it suggests eight library artists and eight recently liked songs, picked at random from the first page of each (one request each, kept five minutes). Suggestions and search results scroll sideways as a shelf, and picking one again takes it back out. The tuning follows YouTube Music's Android radio builder. Music discovery is Familiar, Blend or Discover, and artist variety is Low, Medium or High. Filters offer Popular, Deep cuts or New releases, and Mood offers Pump-up, Chill, Upbeat, Downbeat or Focus. Each filter and mood is optional, and only one of each can be on.

The web player has no radio builder. It only has the tuning chips above the queue of a song radio. Everything here was read off those chips and off the Android app's `FEmusic_radio_builder` page, and checked against `/next` with no account signed in (2026-11-17).

## The playlist id

A tuned radio is an ordinary radio playlist whose id spells out the seeds and the tuning. `radioId` in `packages/core/src/radio.ts` builds it, and it plays through `engine.mix`, like "Start radio" (`/next` with `params: wAEB`). The id is `RDAT` followed by these parts, in this order:

1. Modifiers, defaults left out. Mood is `mY` pump-up, `mX` chill, `mb` upbeat, `mc` downbeat or `ma` focus. New releases is `dX`. Popular is `pY` and deep cuts `pX`. Familiar is `iY` and discover `iX`. Low variety is `rX` and high `rZ`. YouTube answers an empty radio when they come in any other order.
2. Artists: `a<id>` for the first, `I<id>` for each one after, then `E`. The id is the artist's Knowledge Graph id without its `/m/` or `/g/` prefix, so The Beatles (`/m/07c0j`) are `a07c0jE`.
3. Songs: `v<videoId>` each.

An id 13 characters long ends in a `z` (`RDATpYa0kr_tEz`, `RDATa0_yc88vEz`), as YouTube's own chip ids do. YouTube reads `RD` followed by 11 characters as the radio of a video, so without the `z` it plays another radio, or none. A `z` on any other id gives an empty radio, so a longer id, such as a mix made in the Android app (`RDATiXrZa11svx3kx26I…E`), has none. Checked against `/next` and the radio's page with no account signed in, over one to nine artists, with and without modifiers (2026-11-17).

The chips carry decades (`d0X` 2010s, `d1X` 2020s, `d-` 2000s) and genres (`g9X` pop, or `G<id>E` for a Knowledge Graph genre). Genres come before moods and decades before popularity. The builder doesn't offer these yet.

Some combinations are too narrow, and `/next` then answers with an empty panel. Deep cuts with discover and high variety on one artist is one of them. The Android app checks with `music/radio_availability` before it starts. The dialog plays the radio as you tune it and says when YouTube can't make it.

## Finding an artist's id

Search results and artist pages don't carry the Knowledge Graph id. The radio builder's own search (`musicRadioBuilderSearchCommand`) returns nothing with no account signed in. The up-next panel of the artist's own mix (`RDEM…`, from the artist page's header) does carry it: its Popular, Discover and Deep cuts chips are tuned radios of that one artist (`RDATpYa0tvhb2pE`). `engine.radioArtist` reads it from them, so adding an artist costs two requests, the artist page and its mix. An artist with no mix or no chips can't seed a radio, and the dialog strikes it through.

Songs need no lookup: any video id works.

## The cover and the name

A tuned radio's page (`VL` + its id) has a header with a name ("Coldplay, Muse Mix", or "Roygbiv Mix • Like Coldplay • Discover") and a cover YouTube draws from the seeds, at `music.youtube.com/image/radioart?r=…`. `engine.radioCover` reads both. The dialog shows them as the radio's preview, and the queue shows them under "Playing from". The cover is saved with the queue (`QueueFrom.thumbnails`). The `img` scheme fetches `radioart` as the one path it allows on `music.youtube.com` (see [Artwork](artwork.md)).

## Tuning chips above the queue

YouTube Music shows a row of chips above the queue of any mix or radio: "All", then tuned versions of it (Popular, Discover, Deep cuts, a mood, decades, genres). Each chip's playlist id is the mix's own seeds with one more modifier: a song radio `RDAMVM<videoId>` offers `RDATpYv<videoId>`, an artist mix `RDEM…` offers `RDATpYa<artist>E`, and a tuned radio offers itself with one more modifier each. `engine.radioChips` reads them from the same `/next` answer the mix plays from, skipping the "Save" chip, which opens a dialog instead.

The queue shows the chips when it knows the mix it plays: `QueueFrom.radio`, set by a song radio (`RDAMVM<videoId>`), "Start radio", and "Create a mix". The chips are always those of that mix, so after picking one the rest stay in reach and "All" goes back. Picking one plays its radio (`engine.mix`) after the playing song in place of what was to come (the `replaceUpcoming` queue action), leaving out songs already played, and records the pick in `QueueFrom.tuned`. YouTube's chips do the same: their command is a queue update that dedupes against the local queue. A chip whose radio comes back empty leaves the queue as it was.

## Editing a mix

The Android app lets you edit a mix made with "Create mix", and some of YouTube's own (Familiar mix), but not a song radio. Nothing in YouTube's answers marks a mix as editable or carries its seeds: the radio's page and `/next` have no edit command, and `FEmusic_radio_builder` ignores every way tried of handing it a playlist id. The Android builder page does show how it works, though: each seed it offers carries a one-seed radio id (`RDATa0kr_tE`) and each tuning chip a piece of one (`RDATpY`), so the app builds the id from the picks and can read a mix back from its id alone.

yMusic does the same. `parseRadioId` in `packages/core/src/radio.ts` is the reverse of `radioId`, and only takes an id `radioId` gives back, so decades, genres, and new releases with a popularity (none of which the builder offers) are left alone rather than dropped. "Edit mix" shows in the header of a playlist whose id reads back (a mix opened from the home page or the library), and next to "Playing from" when the radio playing (the picked chip, or else the mix) does. Playing a mix from its playlist page (any `RD…` id) names it as the queue's radio, so its chips and the edit button show as for one started here. The id names its seeds only by id, so the builder first names them: an artist from the page of a radio of that artist alone ("Coldplay Mix", one request, works signed out), and a song from the head of its own radio played as a mix started on it (`RDAMVM<videoId>` with that `videoId`), since a song radio leaves its song out. A seed whose lookup fails opens as "Unknown artist" or "Unknown song", and the next opening asks again. An artist picked in the search that turns out to be one already in the mix is dropped. From the queue, updating plays the new radio after the current song, like a chip, and it becomes the mix the queue plays, with its own name, cover and chips. From a playlist page, it opens the new mix's page without playing it, as the Android app does. A mix is only its id, so editing one makes a new playlist rather than changing the old: when the old one is saved in the library (the page's `saved`), the new one is saved and the old one removed, the new first so that a failure halfway leaves both.
