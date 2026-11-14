import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Parser, YTMusic } from "youtubei.js";
import type { SearchResults } from "@ymusic/core";

import { resultsFrom, searchMore } from "./search.ts";
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
      year: null,
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

/**
 * A recorded `/search` response (signed out, trimmed of tracking fields), run
 * through youtubei.js's own parser as the engine does, so these tests catch a
 * youtubei.js upgrade that renames what `resultsFrom` reads.
 */
function recorded(name: string, filtered: boolean): SearchResults {
  const data: unknown = JSON.parse(
    readFileSync(new URL(`./fixtures/search-${name}.json`, import.meta.url), "utf8"),
  );
  return resultsFrom(new YTMusic.Search({ data } as never, null as never, filtered));
}

const shelfOf = (results: SearchResults, filter: string) =>
  results.shelves.find((shelf) => shelf.filter === filter);
const titles = (results: SearchResults, filter: string) => {
  const shelf = shelfOf(results, filter);
  if (!shelf) return [];
  return shelf.kind === "tracks"
    ? shelf.tracks.map((t) => t.title)
    : shelf.cards.map((c) => c.title);
};

describe("resultsFrom, unfiltered", () => {
  const boc = recorded("all-boards-of-canada", false);
  const daft = recorded("all-daft-punk", false);

  it("reads the top result card and the songs it lists", () => {
    expect(boc.top?.item).toMatchObject({
      kind: "card",
      card: { kind: "artist", id: "UCidyEq0ZC6rcqZmwKt_g_2g", title: "Boards of Canada" },
    });
    expect(boc.top?.tracks.map((t) => t.id)).toEqual([
      "yt:9Fnb7APrAeo",
      "yt:Dj11Y1cVnAs",
      "yt:ArCrT2mOOuE",
    ]);
  });

  it("sorts the mixed rows into shelves, each where its best row ranked", () => {
    expect(boc.shelves.map((s) => s.filter)).toEqual([
      "albums",
      "songs",
      "videos",
      "community-playlists",
    ]);
    expect(titles(boc, "albums")).toEqual([
      "Inferno",
      "Music Has The Right To Children",
      "Geogaddi",
    ]);
    expect(titles(daft, "featured-playlists")).toEqual([
      "Presenting Daft Punk",
      "Indie Sleaze",
      "Best Of French Touch",
    ]);
    expect(titles(daft, "artists")).toEqual(["The Weeknd", "Pharrell", "Pentatonix"]);
  });

  it("plays videos as tracks, by their uploader", () => {
    const videos = shelfOf(boc, "videos");
    expect(videos?.kind).toBe("tracks");
    if (videos?.kind !== "tracks") return;
    expect(videos.tracks[0]).toMatchObject({
      id: "yt:EDq9rJKHx0s",
      title: "Boards Of Canada Mix (Focus/ Driving)",
      artists: [{ name: "INADRM", channelId: "UCD2YR-hsMQaQKT6O6isoWFA" }],
      album: null,
    });
    // Every row has art; a thumbnail getter lost in a copy would leave none.
    expect(videos.tracks.every((t) => t.thumbnails.length > 0)).toBe(true);
  });

  it("keeps an official video youtubei.js does not recognise", () => {
    // MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC comes back as item_type "unknown",
    // with the id only on the title's play link.
    expect(titles(boc, "videos")).toContain("Hi Scores (Trailer)");
  });

  it("drops profiles, podcasts and episodes, which have no page here", () => {
    const all = boc.shelves.flatMap((s) => (s.kind === "cards" ? s.cards.map((c) => c.id) : []));
    expect(all.some((id) => id.startsWith("MPSP"))).toBe(false);
    expect(titles(daft, "artists")).not.toContain("why daftpunk!!!!");
    expect(titles(boc, "videos").some((t) => t.startsWith("Episode"))).toBe(false);
  });

  it("opens playlists by their bare id and keeps the owner, not the kind, in the subtitle", () => {
    const community = shelfOf(boc, "community-playlists");
    if (community?.kind !== "cards") throw new Error("no community playlists");
    expect(community.cards[0]).toMatchObject({
      kind: "playlist",
      id: "PL_oay1OMaE2bcuKlfqRwNK0qQg0Xhhtjt",
      title: "Best of Boards of Canada",
    });
    expect(community.cards[0]!.subtitle).toMatch(/^Seanothan • /);
    const featured = shelfOf(daft, "featured-playlists");
    if (featured?.kind !== "cards") throw new Error("no featured playlists");
    expect(featured.cards[0]!.id).toBe("RDCLAK5uy_n20FRYQXNt1p1wS55Nj2r14IouO5weaYU");
    expect(featured.cards[0]!.subtitle).toMatch(/^YouTube Music • \d+ songs$/);
  });

  it("keeps the album kind in an album's subtitle", () => {
    const albums = shelfOf(boc, "albums");
    if (albums?.kind !== "cards") throw new Error("no albums");
    expect(albums.cards[0]!.subtitle).toMatch(/^Album • Boards of Canada • \d{4}$/);
  });

  it("offers the chips YouTube offered, in YouTube Music's order", () => {
    expect(boc.filters).toEqual(["songs", "videos", "albums", "community-playlists", "artists"]);
    expect(daft.filters).toEqual([
      "songs",
      "videos",
      "albums",
      "featured-playlists",
      "community-playlists",
      "artists",
    ]);
  });
});

describe("resultsFrom, filtered", () => {
  it.each([
    ["songs", "songs", "Melissa Juice"],
    ["videos", "videos", "Boards Of Canada Mix (Focus/ Driving)"],
    ["albums", "albums", "Inferno"],
    ["artists", "artists", "Boards of Canada"],
    ["community-playlists", "community-playlists", "ALL OF BOARDS OF CANADA"],
    ["featured-playlists", "featured-playlists", "Presenting Daft Punk"],
  ])("reads the %s shelf", (fixture, filter, first) => {
    const results = recorded(fixture, true);
    expect(results.top).toBeNull();
    expect(results.shelves.map((s) => s.filter)).toEqual([filter]);
    expect(titles(results, filter)[0]).toBe(first);
  });

  it("has the duration and album a filtered song row carries", () => {
    const songs = shelfOf(recorded("songs", true), "songs");
    if (songs?.kind !== "tracks") throw new Error("no songs");
    expect(songs.tracks[0]).toMatchObject({ durationMs: 93_000, album: expect.any(String) });
  });
});

describe("searchMore", () => {
  /** A page whose continuation answers with the recorded second page of videos, forever. */
  const page = () => {
    const data: unknown = JSON.parse(
      readFileSync(new URL("./fixtures/search-videos-continuation.json", import.meta.url), "utf8"),
    );
    const next = {
      contents: Parser.parseResponse(data as never).continuation_contents as never,
      getContinuation: async () => next,
    };
    return { getContinuation: async () => next };
  };

  it("reads the next page of a chip as that chip's shelf", async () => {
    const { results, more } = await searchMore(page(), 1)();
    expect(results.shelves.map((s) => s.filter)).toEqual(["videos"]);
    expect(titles(results, "videos")).toHaveLength(3);
    expect(titles(results, "videos")).toContain("Booba x Daft Punk - Touch (Remix)");
    expect(more).not.toBeNull();
  });

  it("stops after ten pages, however many YouTube offers", async () => {
    let more: ReturnType<typeof searchMore> | null = searchMore(page(), 1);
    let pages = 1;
    while (more) {
      more = (await more()).more;
      pages += 1;
    }
    expect(pages).toBe(10);
  });
});

describe("resultsFrom, malformed", () => {
  it("returns nothing for a response with no contents", () => {
    expect(resultsFrom({})).toEqual({ top: null, shelves: [], filters: [] });
    expect(resultsFrom({ contents: null })).toEqual({ top: null, shelves: [], filters: [] });
  });

  it("skips rows that are not list items, and keeps the rest", () => {
    const results = resultsFrom({
      contents: [
        { type: "ItemSection", contents: [{ type: "Message" }] },
        {
          type: "MusicShelf",
          contents: [{ type: "MusicResponsiveListItem", item_type: "song", id: "a", title: "A" }],
        },
      ],
    });
    expect(titles(results, "songs")).toEqual(["A"]);
  });
});
