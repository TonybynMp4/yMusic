import { describe, expect, it } from "vitest";

import {
  albumFrom,
  artistFrom,
  countsFrom,
  itemIdOf,
  libraryFrom,
  playlistFrom,
  targetsFrom,
  toCard,
} from "./browse.ts";
import { toTrack } from "./parse.ts";

/** youtubei.js `Text`: a string with runs. Enough of one for the parsers. */
function text(value: string, runs?: { text: string; endpoint?: { payload: { browseId: string } } }[]) {
  return { toString: () => value, runs: runs ?? [{ text: value }] };
}

const art = (size: number) => ({
  url: `https://lh3.googleusercontent.com/cover=w${size}-h${size}-l90-rj`,
  width: size,
  height: size,
});

const BOC = "UCidyEq0ZC6rcqZmwKt_g_2g";
const boc = { payload: { browseId: BOC } };

describe("albumFrom", () => {
  // Album rows as YouTube sends them: no art, no artists, no album.
  const raw = {
    header: {
      title: text("Music Has The Right To Children"),
      subtitle: text("Album • 1998"),
      second_subtitle: text("18 songs • 1 hour"),
      strapline_text_one: text("Boards of Canada", [{ text: "Boards of Canada", endpoint: boc }]),
      thumbnail: { contents: [art(60), art(544), art(226)] },
    },
    contents: [
      { id: "aaa", title: "Wildlife Analysis", duration: { seconds: 77 } },
      { id: "bbb", title: "An Eagle In Your Mind", duration: { seconds: 383 } },
      { title: "no id: dropped" },
    ],
  };

  it("fills each track's album, artists and art from the header", () => {
    const album = albumFrom("MPREb_x", raw);
    expect(album.title).toBe("Music Has The Right To Children");
    expect(album.subtitle).toBe("Album • 1998 • 18 songs • 1 hour");
    expect(album.artists).toEqual([{ name: "Boards of Canada", channelId: BOC }]);
    expect(album.thumbnails[0]!.width).toBe(544);
    expect(album.tracks.map((t) => t.id)).toEqual(["yt:aaa", "yt:bbb"]);
    for (const track of album.tracks) {
      expect(track.album).toBe("Music Has The Right To Children");
      expect(track.albumId).toBe("MPREb_x");
      expect(track.artists).toEqual(album.artists);
      expect(track.thumbnails).toEqual(album.thumbnails);
      expect(track.year).toBe(1998);
    }
  });

  it("reads the album's playlist and whether it is saved from the header buttons", () => {
    const album = albumFrom("MPREb_x", {
      header: {
        ...raw.header,
        buttons: [
          { type: "ToggleButton", is_toggled: true },
          { type: "MusicPlayButton", endpoint: { payload: { playlistId: "OLAK5uy_x" } } },
        ],
      },
    });
    expect(album.audioPlaylistId).toBe("OLAK5uy_x");
    expect(album.saved).toBe(true);
    expect(albumFrom("MPREb_x", raw).saved).toBeNull();
  });

  it("keeps an unlinked byline as a name-only artist", () => {
    const album = albumFrom("MPREb_x", {
      header: { ...raw.header, strapline_text_one: text("Various Artists") },
    });
    expect(album.artists).toEqual([{ name: "Various Artists", channelId: null }]);
  });
});

describe("artistFrom", () => {
  const card = (item_type: string, id: string, title: string) => ({
    item_type,
    id,
    title: text(title),
    subtitle: text("Album • 1998"),
    thumbnail: [art(226)],
    endpoint: { payload: { browseId: id } },
  });

  it("splits top songs from the card shelves and drops what cannot be opened", () => {
    const artist = artistFrom(BOC, {
      header: { title: text("Boards of Canada"), description: text("Scottish duo") },
      sections: [
        {
          type: "MusicShelf",
          title: text("Top songs"),
          contents: [{ id: "aaa", title: "Roygbiv" }],
          endpoint: { payload: { browseId: "VLOLAK5uy_top" } },
        },
        {
          type: "MusicCarouselShelf",
          header: { title: text("Albums") },
          contents: [card("album", "MPREb_1", "Geogaddi")],
        },
        {
          type: "MusicCarouselShelf",
          header: { title: text("Videos") },
          contents: [card("video", "vvv", "Dayvan Cowboy")],
        },
        {
          type: "MusicCarouselShelf",
          header: { title: text("Featured on") },
          contents: [card("playlist", "VLRDCLAK5uy_x", "Blissful Indie")],
        },
      ],
    });
    expect(artist.name).toBe("Boards of Canada");
    expect(artist.description).toBe("Scottish duo");
    expect(artist.topSongs.map((t) => t.title)).toEqual(["Roygbiv"]);
    expect(artist.topSongsPlaylistId).toBe("OLAK5uy_top");
    expect(artist.shelves.map((s) => s.title)).toEqual(["Albums", "Featured on"]);
    expect(artist.shelves[1]!.cards[0]!.id).toBe("RDCLAK5uy_x");
  });

  it("reads the mix and the subscription from the header", () => {
    const artist = artistFrom(BOC, {
      header: {
        title: text("Boards of Canada"),
        subscription_button: { subscribed: true },
        start_radio_button: { endpoint: { payload: { playlistId: "RDEMx", videoId: "aaa" } } },
      },
    });
    expect(artist.mix).toEqual({ playlistId: "RDEMx", videoId: "aaa" });
    expect(artist.subscribed).toBe(true);
    const bare = artistFrom(BOC, { header: { title: text("Boards of Canada") } });
    expect(bare.mix).toBeNull();
    expect(bare.subscribed).toBeNull();
  });

  it("crops a square avatar out of the banner", () => {
    const banner = "https://yt3.googleusercontent.com/abc=w1440-h600-p-l90-rj";
    const artist = artistFrom(BOC, {
      header: { title: text("Thornhill"), thumbnail: { contents: [{ url: banner, width: 1440, height: 600 }] } },
    });
    expect(artist.avatar[0]).toEqual({
      url: "https://yt3.googleusercontent.com/abc=w544-h544-p-l90-rj",
      width: 544,
      height: 544,
    });
  });
});

describe("toCard", () => {
  it("drops a card with no title or of a kind the app cannot open", () => {
    expect(toCard({ item_type: "album", endpoint: { payload: { browseId: "MPREb_1" } } })).toBeNull();
    expect(toCard({ item_type: "episode", id: "x", title: "x" })).toBeNull();
  });
});

describe("libraryFrom", () => {
  it("keeps the playlists, Liked Music included, and drops the New playlist tile", () => {
    const cards = libraryFrom([
      { item_type: "playlist", title: text("New playlist") },
      { item_type: "playlist", title: text("Liked Music"), endpoint: { payload: { browseId: "VLLM" } } },
      { item_type: "playlist", title: text("Mix"), endpoint: { payload: { browseId: "VLPLx" } } },
      { item_type: "album", title: text("Album"), endpoint: { payload: { browseId: "MPREb_1" } } },
    ]);
    expect(cards.map((card) => [card.id, card.title])).toEqual([
      ["LM", "Liked Music"],
      ["PLx", "Mix"],
    ]);
  });
});

describe("playlistFrom", () => {
  it("keeps the rows that are songs", () => {
    const playlist = playlistFrom("PLx", { title: text("Mix"), subtitle: text("Playlist") }, [
      { id: "aaa", title: "One" },
      { title: "broken" },
    ]);
    expect(playlist).toMatchObject({ id: "PLx", title: "Mix", subtitle: "Playlist" });
    expect(playlist.tracks).toHaveLength(1);
  });

  it("is saved or not only when the header has a library toggle", () => {
    const toggle = { buttons: [{ type: "ToggleButton", is_toggled: false }] };
    expect(playlistFrom("PLx", toggle, []).saved).toBe(false);
    expect(playlistFrom("PLx", {}, []).saved).toBeNull();
  });

  it("reads 'N/A', youtubei.js's empty text, as missing", () => {
    expect(playlistFrom("PLx", { subtitle: text("N/A") }, []).subtitle).toBeNull();
  });

  // Your own playlist, as the header and edit form come back from YouTube Music.
  const own = {
    title: text("Road trip"),
    subtitle: text("Playlist • 2024"),
    second_subtitle: text("2 tracks • 7 minutes"),
    strapline_text_one: text("Tony", [{ text: "Tony", endpoint: { payload: { browseId: "UCme" } } }]),
    description: { description: text("Songs for the car") },
  };
  const removable = (setVideoId: string, videoId: string) => ({
    menu: {
      items: [
        { endpoint: { payload: { videoId } } },
        {
          endpoint: {
            payload: {
              actions: [{ action: "ACTION_REMOVE_VIDEO", setVideoId, removedVideoId: videoId }],
            },
          },
        },
      ],
    },
  });

  it("reads the owner, description, count and length off the header", () => {
    const playlist = playlistFrom("PLx", own, [], { privacy: "PRIVATE" });
    expect(playlist).toMatchObject({
      subtitle: "Playlist • 2024",
      owner: { name: "Tony", channelId: "UCme" },
      description: "Songs for the car",
      privacy: "PRIVATE",
      trackCount: 2,
      length: "7 minutes",
      editable: true,
    });
  });

  it("is editable only with the edit form", () => {
    const playlist = playlistFrom("PLx", own, []);
    expect(playlist.editable).toBe(false);
    expect(playlist.privacy).toBeNull();
  });

  it("keeps each row's id within the playlist, in step with the songs", () => {
    const playlist = playlistFrom("PLx", own, [
      { id: "aaa", title: "One", ...removable("S1", "aaa") },
      { title: "broken", ...removable("S2", "bbb") },
      { id: "ccc", title: "Three" },
    ]);
    expect(playlist.tracks.map((t) => t.title)).toEqual(["One", "Three"]);
    expect(playlist.itemIds).toEqual(["S1", null]);
  });
});

describe("itemIdOf", () => {
  it("is null without a remove item", () => {
    expect(itemIdOf({})).toBeNull();
    expect(itemIdOf({ menu: { items: [{ endpoint: { payload: { actions: [] } } }] } })).toBeNull();
  });
});

describe("countsFrom", () => {
  it("reads the count and length, past the views", () => {
    expect(countsFrom("1.2K views • 1,204 tracks • 7+ hours")).toEqual({
      tracks: 1204,
      length: "7+ hours",
    });
    expect(countsFrom("1 song • 1 hour, 5 minutes")).toEqual({
      tracks: 1,
      length: "1 hour, 5 minutes",
    });
  });

  it("is empty without the line", () => {
    expect(countsFrom(null)).toEqual({ tracks: null, length: null });
  });
});

describe("toTrack album fallback", () => {
  it("finds the album among the columns when youtubei.js misses it", () => {
    // A top-songs row: the third column is a play count, the fourth the album.
    const track = toTrack({
      id: "aaa",
      title: "The Word Becomes Flesh",
      flex_columns: [
        { title: { runs: [{ text: "The Word Becomes Flesh" }] } },
        { title: { runs: [{ text: "Boards of Canada", endpoint: boc }] } },
        { title: { runs: [{ text: "1.1M plays" }] } },
        { title: { runs: [{ text: "Inferno", endpoint: { payload: { browseId: "MPREb_inf" } } }] } },
      ],
    });
    expect(track).toMatchObject({ album: "Inferno", albumId: "MPREb_inf" });
  });
});

describe("targetsFrom", () => {
  it("keeps the playlists with an id and a title", () => {
    expect(
      targetsFrom([
        { playlist_id: "PLa", title: text("Road trip") },
        { playlist_id: "PLb", title: text("N/A") },
        { title: text("no id") },
      ]),
    ).toEqual([{ id: "PLa", title: "Road trip" }]);
  });
});
