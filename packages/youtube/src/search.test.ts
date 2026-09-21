import { describe, expect, it } from "vitest";

import { songsFrom } from "./search.ts";
import { toTrack, type RawSong } from "./parse.ts";
import { toThumbnails } from "./thumbnails.ts";

/** A row shaped the way youtubei.js 18 returns one, trimmed to what we read. */
const song: RawSong = {
  id: "SM4tQcUt_mQ",
  item_type: "song",
  title: "Roygbiv",
  duration: { seconds: 150 },
  album: { name: "Music Has The Right To Children" },
  artists: [{ name: "Boards of Canada", channel_id: "UCidyEq0ZC6rcqZmwKt_g_2g" }],
  thumbnails: [
    { url: "https://lh3.googleusercontent.com/abc=w120-h120-l90-rj", width: 120, height: 120 },
    { url: "https://lh3.googleusercontent.com/abc=w60-h60-l90-rj", width: 60, height: 60 },
  ],
};

describe("toTrack", () => {
  it("lifts a song row into a namespaced domain track", () => {
    const track = toTrack(song);
    expect(track).not.toBeNull();
    expect(track!.id).toBe("yt:SM4tQcUt_mQ");
    expect(track!.title).toBe("Roygbiv");
    expect(track!.durationMs).toBe(150_000);
    expect(track!.album).toBe("Music Has The Right To Children");
    expect(track!.artists).toEqual([
      { name: "Boards of Canada", channelId: "UCidyEq0ZC6rcqZmwKt_g_2g" },
    ]);
    expect(track!.isExplicit).toBe(false);
  });

  it("reads the explicit badge by icon rather than by its label", () => {
    // The label is localised; the icon type is not.
    const explicit = toTrack({
      ...song,
      badges: [{ icon_type: "MUSIC_EXPLICIT_BADGE" }],
    });
    expect(explicit!.isExplicit).toBe(true);
  });

  it("keeps a song that is missing everything optional", () => {
    const sparse = toTrack({ id: "abc123", title: "Untitled" });
    expect(sparse).toEqual({
      id: "yt:abc123",
      title: "Untitled",
      artists: [],
      album: null,
      albumId: null,
      durationMs: null,
      thumbnails: [],
      isExplicit: false,
    });
  });

  it("drops a row with no id or no title, which cannot be played or shown", () => {
    expect(toTrack({ title: "No id" })).toBeNull();
    expect(toTrack({ id: "abc123" })).toBeNull();
    expect(toTrack({ id: "", title: "Empty id" })).toBeNull();
  });

  it("treats a missing or zero duration as live rather than as zero length", () => {
    expect(toTrack({ ...song, duration: null })!.durationMs).toBeNull();
    expect(toTrack({ ...song, duration: { seconds: 0 } })!.durationMs).toBeNull();
  });

  it("skips artist entries with no name instead of inventing one", () => {
    const track = toTrack({
      ...song,
      artists: [{ name: "Real" }, { channel_id: "UC123" }, { name: "" }],
    });
    expect(track!.artists).toEqual([{ name: "Real", channelId: null }]);
  });
});

describe("toThumbnails", () => {
  it("asks the CDN for a larger image but keeps the known-good original", () => {
    const [first, ...rest] = toThumbnails(song.thumbnails!);
    expect(first).toEqual({
      url: "https://lh3.googleusercontent.com/abc=w544-h544-l90-rj",
      width: 544,
      height: 544,
    });
    expect(rest).toHaveLength(2);
    expect(rest[0]!.width).toBe(120);
  });

  it("leaves a URL alone when it does not encode a size", () => {
    const thumbs = toThumbnails([
      { url: "https://example.com/cover.jpg", width: 120, height: 120 },
    ]);
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]!.url).toBe("https://example.com/cover.jpg");
  });

  it("drops a malformed entry without losing the good ones", () => {
    const thumbs = toThumbnails([
      { url: "not a url", width: 120, height: 120 },
      { url: "https://example.com/a.jpg", width: 0, height: 120 },
      { url: "https://example.com/b.jpg", width: 120, height: 120 },
    ]);
    expect(thumbs.map((t) => t.url)).toEqual(["https://example.com/b.jpg"]);
  });

  it("returns nothing rather than a placeholder when there is no art", () => {
    expect(toThumbnails(undefined)).toEqual([]);
    expect(toThumbnails([])).toEqual([]);
  });
});

describe("songsFrom", () => {
  it("picks the song shelf by type, not by being the first with contents", () => {
    // A real response leads with a notice section. Taking the first populated
    // shelf would return that instead of any songs.
    const tracks = songsFrom({
      contents: [
        { type: "ItemSection", contents: [{ type: "Message" }] },
        { type: "MusicShelf", contents: [song] },
      ],
    });
    expect(tracks.map((t) => t.id)).toEqual(["yt:SM4tQcUt_mQ"]);
  });

  it("returns nothing when the response carries no song shelf", () => {
    expect(songsFrom({ contents: [{ type: "ItemSection", contents: [] }] })).toEqual([]);
    expect(songsFrom({ contents: null })).toEqual([]);
    expect(songsFrom({})).toEqual([]);
  });

  it("drops unplayable rows but keeps the rest of the shelf", () => {
    const tracks = songsFrom({
      contents: [{ type: "MusicShelf", contents: [song, { type: "Message" }, song] }],
    });
    expect(tracks).toHaveLength(2);
  });
});
