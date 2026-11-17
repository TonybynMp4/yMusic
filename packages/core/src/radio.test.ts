import { describe, expect, it } from "vitest";
import type { VideoId } from "./domain.ts";
import { defaultTuning, parseRadioId, radioArtist, radioId, type RadioTuning } from "./radio.ts";

const tuning = (over: Partial<RadioTuning>): RadioTuning => ({
  artists: [],
  songs: [],
  ...defaultTuning,
  ...over,
});

describe("radioId", () => {
  // Every expected id here was checked to play on music.youtube.com, and most
  // are ids YouTube hands out itself on its queue chips.
  it.each<[string, Partial<RadioTuning>, string | null]>([
    ["no seeds", {}, null],
    ["one artist", { artists: ["0kr_t"] }, "RDATa0kr_tE"],
    ["an artist padded with z", { artists: ["0_yc88v"] }, "RDATa0_yc88vEz"],
    ["two artists", { artists: ["0kr_t", "0187x8"] }, "RDATa0kr_tI0187x8E"],
    [
      "a long id one past a multiple of four, with no z",
      { artists: ["11svx3kx26", "11pkb0819t"], discovery: "discover", variety: "high" },
      "RDATiXrZa11svx3kx26I11pkb0819tE",
    ],
    ["popular", { artists: ["0kr_t"], filter: "popular" }, "RDATpYa0kr_tEz"],
    ["latest", { artists: ["0kr_t"], filter: "latest" }, "RDATdXa0kr_tEz"],
    ["discover", { artists: ["0187x8"], discovery: "discover" }, "RDATiXa0187x8E"],
    [
      "every modifier in YouTube's order",
      {
        artists: ["0kr_t", "0187x8"],
        mood: "chill",
        filter: "deepCuts",
        discovery: "discover",
        variety: "high",
      },
      "RDATmXpXiXrZa0kr_tI0187x8E",
    ],
    ["a song", { songs: ["BJwovrr6XzI" as VideoId] }, "RDATvBJwovrr6XzI"],
    [
      "artists then songs",
      { artists: ["0kr_t"], songs: ["BJwovrr6XzI", "IO_GLvVB5Vc"] as VideoId[] },
      "RDATa0kr_tEvBJwovrr6XzIvIO_GLvVB5Vc",
    ],
    [
      "no z before songs",
      { artists: ["0_yc88v"], songs: ["SM4tQcUt_mQ" as VideoId] },
      "RDATa0_yc88vEvSM4tQcUt_mQ",
    ],
    [
      "no z after songs",
      { artists: ["0kr_t"], songs: ["SM4tQcUt_mQ" as VideoId], discovery: "discover" },
      "RDATiXa0kr_tEvSM4tQcUt_mQ",
    ],
  ])("%s", (_, over, expected) => {
    expect(radioId(tuning(over))).toBe(expected);
  });
});

describe("radioArtist", () => {
  it.each<[string, string | null]>([
    ["RDATpYa0tvhb2pE", "0tvhb2p"],
    ["RDATiXa0kr_tEz", "0kr_t"],
    ["RDATpXa11hfhf66_dE", "11hfhf66_d"],
    // An artist's own mix, a decade chip, a genre chip, a song radio.
    ["RDEMrxTesNM2UxWELZx2vsoG2A", null],
    ["RDATd0Xa0tvhb2pE", null],
    ["RDATG02rp117Ea0tvhb2pE", null],
    ["RDATpYvyKNxeF4KMsY", null],
    // Two artists: not the one this reads.
    ["RDATpYa0kr_tI0187x8E", null],
  ])("%s", (id, expected) => {
    expect(radioArtist(id)).toBe(expected);
  });
});

describe("parseRadioId", () => {
  it.each<[string, Partial<RadioTuning>]>([
    ["RDATa0kr_tE", { artists: ["0kr_t"] }],
    ["RDATa0_yc88vEz", { artists: ["0_yc88v"] }],
    ["RDATpYa0kr_tEz", { artists: ["0kr_t"], filter: "popular" }],
    ["RDATdXa0kr_tEz", { artists: ["0kr_t"], filter: "latest" }],
    ["RDATiYrXa0kr_tE", { artists: ["0kr_t"], discovery: "familiar", variety: "low" }],
    [
      "RDATmXpXiXrZa0kr_tI0187x8E",
      {
        artists: ["0kr_t", "0187x8"],
        mood: "chill",
        filter: "deepCuts",
        discovery: "discover",
        variety: "high",
      },
    ],
    ["RDATpYvBJwovrr6XzI", { songs: ["BJwovrr6XzI" as VideoId], filter: "popular" }],
    [
      "RDATa0kr_tEvBJwovrr6XzIvIO_GLvVB5Vc",
      { artists: ["0kr_t"], songs: ["BJwovrr6XzI", "IO_GLvVB5Vc"] as VideoId[] },
    ],
  ])("reads %s", (id, expected) => {
    expect(parseRadioId(id)).toEqual(tuning(expected));
  });

  it.each([
    ["a song radio", "RDAMVMBJwovrr6XzI"],
    ["an artist mix", "RDEMabc"],
    ["no seeds", "RDATpY"],
    ["a missing z", "RDATa0_yc88vE"],
    ["a misplaced z", "RDATa0kr_tEz"],
    ["a decade", "RDATd0Xa0kr_tE"],
    ["a genre", "RDATg9Xa0kr_tE"],
    ["new releases with a popularity", "RDATdXpYa0kr_tE"],
    ["modifiers out of order", "RDATiXpYa0kr_tE"],
  ])("refuses %s", (_, id) => {
    expect(parseRadioId(id)).toBeNull();
  });
});
