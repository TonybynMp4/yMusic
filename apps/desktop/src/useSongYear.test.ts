import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoId } from "@ymusic/core";

import type { engine as realEngine } from "./engine.ts";

const engine = vi.hoisted(() => ({
  songYear: vi.fn<(typeof realEngine)["songYear"]>(),
}));

// The real engine starts a worker; these tests only need what it returns.
vi.mock("./engine.ts", () => ({ engine }));

/** The cache lives at the module's top level, so each test gets a fresh copy. */
let lookUpYear: typeof import("./useSongYear.ts").lookUpYear;

const song = (n: number) => `song${n}` as VideoId;

function lookups(id: VideoId): number {
  return engine.songYear.mock.calls.filter(([asked]) => asked === id).length;
}

beforeEach(async () => {
  vi.resetModules();
  engine.songYear.mockReset().mockResolvedValue(2024);
  ({ lookUpYear } = await import("./useSongYear.ts"));
});

describe("lookUpYear", () => {
  it("asks YouTube once per song", async () => {
    expect(await lookUpYear(song(1))).toBe(2024);
    expect(await lookUpYear(song(1))).toBe(2024);
    expect(engine.songYear).toHaveBeenCalledTimes(1);
  });

  it("keeps the latest 500 songs and asks again for an older one", async () => {
    for (let n = 0; n <= 500; n++) await lookUpYear(song(n));
    await lookUpYear(song(1));
    expect(lookups(song(1))).toBe(1);

    await lookUpYear(song(0));
    expect(lookups(song(0))).toBe(2);
  });

  it("drops by first lookup, so showing a song again does not keep it longer", async () => {
    for (let n = 0; n < 500; n++) await lookUpYear(song(n));
    await lookUpYear(song(0));
    await lookUpYear(song(500));

    await lookUpYear(song(0));
    expect(lookups(song(0))).toBe(2);
  });

  it("forgets a failed lookup, so the next one tries again", async () => {
    engine.songYear.mockRejectedValueOnce(new Error("offline"));
    expect(await lookUpYear(song(1))).toBeNull();
    expect(await lookUpYear(song(1))).toBe(2024);
    expect(engine.songYear).toHaveBeenCalledTimes(2);
  });
});
