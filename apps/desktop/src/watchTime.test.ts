import { Listened } from "@ymusic/core";
import { describe, expect, it } from "vitest";

import { WatchTime } from "./watchTime.ts";

const LENGTH = 200_000;

/** Feeds `[positionMs, at]` pairs in order and returns the stretches. */
function listen(samples: [number, number][], durationMs: number | null = LENGTH) {
  const watched = new WatchTime();
  for (const [positionMs, at] of samples) watched.observe(positionMs, at, durationMs);
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

  it("adds what played before a seek when the last position is old", () => {
    const watched = listen([
      [30_000, 0],
      // Eight seconds on, a seek back to two seconds.
      [2_000, 8_000],
      [12_000, 18_000],
    ]);
    expect(watched.take()).toEqual([
      [30_000, 38_000],
      [2_000, 12_000],
    ]);
  });

  it("adds what played up to the end when the next song starts from zero", () => {
    const watched = listen([
      [185_000, 0],
      [195_000, 10_000],
      // The song ended four seconds later and the position went back to 0.
      [0, 14_100],
    ]);
    expect(watched.take()).toEqual([[185_000, 199_100]]);
  });

  it("never goes past the end of the song", () => {
    const watched = listen([
      [195_000, 0],
      [0, 9_000],
    ]);
    expect(watched.take()).toEqual([[195_000, 200_000]]);
  });

  it("adds nothing before a seek without the song's length", () => {
    const watched = listen(
      [
        [30_000, 0],
        [31_000, 1_000],
        [2_000, 9_000],
      ],
      null,
    );
    expect(watched.take()).toEqual([[30_000, 31_000]]);
  });

  it("starts a stretch with nothing before it", () => {
    expect(listen([[7_000, 0]]).take()).toEqual([]);
  });
});

describe("WatchTime.pause", () => {
  it("leaves a recent position as it is", () => {
    const watched = listen([
      [5_000, 0],
      [6_000, 1_000],
    ]);
    watched.pause(1_400, LENGTH);
    expect(watched.take()).toEqual([[5_000, 6_000]]);
  });

  it("adds the time since an old position", () => {
    const watched = listen([
      [5_000, 0],
      [15_000, 10_000],
    ]);
    watched.pause(18_000, LENGTH);
    expect(watched.take()).toEqual([[5_000, 23_000]]);
  });

  it("adds nothing when it was not playing", () => {
    const watched = listen([
      [5_000, 0],
      [15_000, 10_000],
    ]);
    watched.pause(null, LENGTH);
    expect(watched.take()).toEqual([[5_000, 15_000]]);
  });

  it("starts a new stretch afterwards, however close the next position", () => {
    const watched = listen([
      [5_000, 0],
      [6_000, 1_000],
    ]);
    watched.pause(1_200, LENGTH);
    watched.observe(6_200, 60_000, LENGTH);
    watched.observe(7_200, 61_000, LENGTH);
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
    watched.observe(20_000, 20_000, LENGTH);
    expect(watched.take()).toEqual([[10_000, 20_000]]);
  });
});
