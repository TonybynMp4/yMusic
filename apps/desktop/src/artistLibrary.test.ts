import { describe, expect, it } from "vitest";
import type { TrackId } from "@ymusic/core";
import type { LocalTrack } from "@ymusic/ipc";

import { localByArtist } from "./artistLibrary.ts";

function song(
  title: string,
  artist: string,
  extra: Partial<Pick<LocalTrack, "album" | "albumArtist" | "trackNumber" | "discNumber">> = {},
): LocalTrack {
  return {
    id: `local:${title}` as TrackId,
    title,
    artists: [{ name: artist, channelId: null }],
    album: null,
    albumId: null,
    durationMs: null,
    thumbnails: [],
    isExplicit: false,
    year: null,
    path: `/music/${title}.flac`,
    albumArtist: null,
    trackNumber: null,
    discNumber: null,
    addedAt: 0,
    ...extra,
  };
}

const titles = (tracks: LocalTrack[]) => tracks.map((t) => t.title);

describe("localByArtist", () => {
  it("matches the artist ignoring case, accents and spacing", () => {
    const local = [song("a", "Beyoncé"), song("b", "  beyonce "), song("c", "Beyoncé Fan")];
    expect(titles(localByArtist(local, "BEYONCE"))).toEqual(["a", "b"]);
  });

  it("matches each artist a tag credits, and the whole tag", () => {
    const local = [
      song("a", "Daft Punk feat. Pharrell Williams"),
      song("b", "Pharrell Williams, Jay-Z"),
      song("c", "Simon & Garfunkel"),
      song("d", "Pharrell Williams ft. Someone"),
    ];
    expect(titles(localByArtist(local, "Pharrell Williams"))).toEqual(["a", "b", "d"]);
    expect(titles(localByArtist(local, "Simon & Garfunkel"))).toEqual(["c"]);
  });

  it("matches the album artist", () => {
    const local = [song("a", "Someone Else", { albumArtist: "Various; Muse" })];
    expect(titles(localByArtist(local, "Muse"))).toEqual(["a"]);
  });

  it("orders by album, disc and track", () => {
    const local = [
      song("b2", "Muse", { album: "B", discNumber: 1, trackNumber: 2 }),
      song("a10", "Muse", { album: "A", trackNumber: 10 }),
      song("b1", "Muse", { album: "B", discNumber: 1, trackNumber: 1 }),
      song("a2", "Muse", { album: "A", trackNumber: 2 }),
    ];
    expect(titles(localByArtist(local, "Muse"))).toEqual(["a2", "a10", "b1", "b2"]);
  });

  it("matches nothing for a blank name", () => {
    expect(localByArtist([song("a", "Muse")], " ")).toEqual([]);
  });
});
