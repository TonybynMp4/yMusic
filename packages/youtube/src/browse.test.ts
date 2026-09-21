import { describe, expect, it } from "vitest";

import { albumFrom, artistFrom, playlistFrom, toCard } from "./browse.ts";
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
    }
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
});

describe("toCard", () => {
  it("drops a card with no title or of a kind the app cannot open", () => {
    expect(toCard({ item_type: "album", endpoint: { payload: { browseId: "MPREb_1" } } })).toBeNull();
    expect(toCard({ item_type: "episode", id: "x", title: "x" })).toBeNull();
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

  it("reads 'N/A', youtubei.js's empty text, as missing", () => {
    expect(playlistFrom("PLx", { subtitle: text("N/A") }, []).subtitle).toBeNull();
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
