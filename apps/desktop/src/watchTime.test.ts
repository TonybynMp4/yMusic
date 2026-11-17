import { Listened } from "@ymusic/core";
import { describe, expect, it } from "vitest";

import { WatchTime } from "./watchTime.ts";

/** Feeds `[positionMs, at]` pairs in order and returns the stretches. */
function listen(samples: [number, number][]) {
  const watched = new WatchTime();
  for (const [positionMs, at] of samples) watched.observe(positionMs, at);
  return watched;
}

describe("WatchTime.observe", () => {
  it("passes positions a second apart straight through", () => {
    const watched = listen([
      [0, 0],
      [1_000, 1_000],
      [2_000, 2_000],
    ]);
    expect(watched.take()).toEqual([[0, 2_000]]);
  });

  it("keeps one stretch across positions ten seconds apart", () => {
    const watched = listen([
      [5_000, 0],
      [15_000, 10_000],
      [25_020, 20_020],
    ]);
    expect(watched.take()).toEqual([[5_000, 25_020]]);
  });

  it("is needed: Listened alone drops a ten second step", () => {
    const listened = new Listened();
    listened.observe(5_000);
    listened.observe(15_000);
    expect(listened.take()).toEqual([]);
  });

  it("allows a reply that came in a little late", () => {
    const watched = listen([
      [0, 0],
      [11_000, 10_000],
    ]);
    expect(watched.take()).toEqual([[0, 11_000]]);
  });

  it("reads a jump further than the clock moved as a seek", () => {
    const watched = listen([
      [5_000, 0],
      [6_000, 1_000],
      // Fourteen seconds forward, one second later.
      [20_000, 2_000],
      [21_000, 3_000],
    ]);
    expect(watched.take()).toEqual([
      [5_000, 6_000],
      [20_000, 21_000],
    ]);
  });

  it("closes a stretch at the last position before a seek, with no guess past it", () => {
    const watched = listen([
      [30_000, 0],
      // Eight seconds on, a seek back to two seconds.
      [2_000, 8_000],
      [12_000, 18_000],
    ]);
    expect(watched.take()).toEqual([[2_000, 12_000]]);
  });

  it("counts what played before a seek once the fresh position arrives first", () => {
    const watched = listen([
      [30_000, 0],
      // What `syncPosition` brings in just before the seek.
      [38_000, 8_000],
      [2_000, 8_100],
      [12_000, 18_100],
    ]);
    expect(watched.take()).toEqual([
      [30_000, 38_000],
      [2_000, 12_000],
    ]);
  });

  it("counts a stall for what played, not for how long it took", () => {
    const watched = listen([
      [30_000, 0],
      // Eight seconds later the song is only two seconds further on.
      [32_000, 8_000],
    ]);
    expect(watched.take()).toEqual([[30_000, 32_000]]);
  });

  it("runs to the end on the position Rust sends as a song ends", () => {
    const watched = listen([
      [185_000, 0],
      [195_000, 10_000],
      [200_000, 15_000],
    ]);
    watched.pause();
    expect(watched.take()).toEqual([[185_000, 200_000]]);
  });

  it("starts a stretch with nothing before it", () => {
    expect(listen([[7_000, 0]]).take()).toEqual([]);
  });
});

describe("WatchTime.pause", () => {
  it("closes the stretch at the last position", () => {
    const watched = listen([
      [5_000, 0],
      [15_000, 10_000],
      // The position Rust sends ahead of the pause.
      [23_000, 18_000],
    ]);
    watched.pause();
    expect(watched.take()).toEqual([[5_000, 23_000]]);
  });

  it("starts a new stretch afterwards, however close the next position", () => {
    const watched = listen([
      [5_000, 0],
      [6_000, 1_000],
    ]);
    watched.pause();
    watched.observe(6_200, 60_000);
    watched.observe(7_200, 61_000);
    expect(watched.take()).toEqual([
      [5_000, 6_000],
      [6_200, 7_200],
    ]);
  });

  it("carries a stretch on after it was taken", () => {
    const watched = listen([
      [0, 0],
      [10_000, 10_000],
    ]);
    expect(watched.take()).toEqual([[0, 10_000]]);
    watched.observe(20_000, 20_000);
    expect(watched.take()).toEqual([[10_000, 20_000]]);
  });
});
