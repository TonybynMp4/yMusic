# Search

One box searches YouTube Music and the local library together. The local half is the library's own index; this page is about the YouTube Music half, which lives in `packages/youtube/src/search.ts` (the request and the parser) and `apps/desktop/src/Search.tsx` (the results). Recent searches are in [The data engine](engine.md#search-history).

## YouTube Music, not YouTube

Both search on `/youtubei/v1/search`. They differ only by the client in the request body, `WEB_REMIX` against `WEB`. Plain YouTube returns videos with no albums and no artist channels, so asking the wrong one still works, it just gives worse results. `live.test.ts` asserts the client that goes on the wire.

## What YouTube Music sends back

An unfiltered search is not a set of shelves. The answer is a notice section, then a `MusicCardShelf` for the top result (the card and up to three of its songs), then one `ItemSection` per row. Rows of every kind come mixed in YouTube's ranking: a song, then an album, then a video, then a playlist. The answer has no shelf titles, no "Show all" links and no continuation. The header carries the chips: Songs, Videos, Albums, Featured playlists, Community playlists, Artists, and some the app has no use for (profiles, podcasts, episodes).

A filtered search, what a chip sends, answers with one `MusicShelf` of 20 rows and a continuation for more.

The filter is a `params` string. The parser reads which chips YouTube offered by the start of each chip's params, because the chips append a suffix that changes with the query. youtubei.js has no filter value for featured playlists, so `FILTERS` in `search.ts` spells every filter's params out rather than encoding them through the library.

youtubei.js's `YTMusic.Search` parses the answer into classes, and the app reads those structurally. A few things in there are easy to get wrong:

- Videos name their uploader in `authors`, songs in `artists`.
- An official upload that is neither song nor music video (`MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC`, a trailer for example) comes back as `item_type: "unknown"`. Its video id is only on the title's play link.
- `thumbnails` is a getter on the row's class. Spreading a row into a plain object loses it, so `songOf` copies fields by name.
- Artist rows whose page type is `MUSIC_PAGE_TYPE_USER_CHANNEL` are profiles, not artists.
- Featured playlists are YouTube Music's own, and their ids start with `RDCLAK`.

## One request, then one per chip

Opening a search costs one unfiltered request. Selecting a chip costs one filtered request for that chip. The hook (`useYouTubeSearch.ts`) keeps every answer for the current query, so going back to All or to a chip already opened makes no request. A new query clears the kept answers and puts the chips back on All.

The other way would be one filtered request per kind for every query, six at once, then cutting each to a few rows for the All view. I did not do that. It is six times the requests for every keystroke that survives the 350ms debounce, which is a quick way to get rate limited. It also throws away YouTube's ranking across kinds: the unfiltered answer says the album beats the songs for "boards of canada" and the artist leads for "daft punk", and six separate lists cannot say that. The cost of the single request is that the All view gets only what YouTube ranked into it, usually a handful of each kind, which is also what YouTube Music shows there.

The debounce is 350ms for typing and none for a chip, since a chip is one click.

## Layout

This follows YouTube Music's search page:

- The chips sit on top. All is first and selected for a new query.
- Under All: the top result, the card beside its songs (or the song itself first when the top result is a song or video). Then a shelf per kind, each with "Show all", which selects that kind's chip. Shelves come in the order of each kind's best-ranked row, so the order changes with the query, as it does on YouTube Music.
- Songs and videos are track lists. Albums, playlists and artists are cards, the same `Card` and `Shelf` the home and artist pages use, with the same menus.
- Under a chip: the full list for songs and videos, a grid of cards for the rest.
- Local files only show under All, as their own section with its own "Show all".

## What a result does

- A song or video plays and starts its radio, as YouTube Music does. Videos are tracks like songs; the queue and player do not tell them apart.
- An album, playlist or artist opens its page. Featured and community playlists both open the playlist page.
- Playing or opening a result records the query in recent searches.

Profiles, podcasts and episodes are dropped, since the app has no page for them. A chip shows its first 20 rows; the continuation for more is not loaded yet.

## Tests

`search.test.ts` parses recorded answers in `packages/youtube/src/fixtures/search-*.json`: two unfiltered searches and one per filter. They are real responses with tracking, menus and overlays pruned out, and filtered shelves cut to three rows, so a change in YouTube's shape fails against a known answer. The network tests in `live.test.ts` run an unfiltered and a featured-playlists search against YouTube.
