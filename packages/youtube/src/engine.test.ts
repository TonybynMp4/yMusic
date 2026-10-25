import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoId } from "@ymusic/core";
import type { Innertube } from "youtubei.js";

import { YouTubeEngine } from "./engine.ts";
import { fetchSignatureTimestamp, getPlaybackTracking } from "./history.ts";

vi.mock("./client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client.ts")>()),
  createYouTube: async () => ({}) as Innertube,
}));

vi.mock("./history.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./history.ts")>()),
  fetchSignatureTimestamp: vi.fn<typeof fetchSignatureTimestamp>(),
  getPlaybackTracking: vi.fn<typeof getPlaybackTracking>(async () => null),
}));

const HOUR = 60 * 60 * 1000;
const song = "lYBUbBu4W08" as VideoId;

describe("the signature timestamp played() reports with", () => {
  let engine: YouTubeEngine;
  const timestamp = vi.mocked(fetchSignatureTimestamp);

  beforeEach(() => {
    vi.useFakeTimers();
    timestamp.mockReset().mockResolvedValue(20732);
    vi.mocked(getPlaybackTracking).mockClear();
    engine = new YouTubeEngine(globalThis.fetch);
    engine.setCookie("SID=test");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is fetched once and passed to every play report", async () => {
    await engine.played(song);
    await engine.played(song);
    expect(timestamp).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getPlaybackTracking).mock.calls.map((call) => call[2])).toEqual([
      20732, 20732,
    ]);
  });

  it("is fetched again once 12 hours have passed", async () => {
    await engine.played(song);
    vi.advanceTimersByTime(12 * HOUR - 1);
    await engine.played(song);
    expect(timestamp).toHaveBeenCalledTimes(1);

    timestamp.mockResolvedValue(20740);
    vi.advanceTimersByTime(1);
    await engine.played(song);
    expect(timestamp).toHaveBeenCalledTimes(2);
    expect(vi.mocked(getPlaybackTracking).mock.calls.at(-1)?.[2]).toBe(20740);
  });

  it("is not kept when fetching it failed", async () => {
    timestamp.mockRejectedValueOnce(new Error("could not fetch the player script: 503"));
    await expect(engine.played(song)).rejects.toThrow("503");
    await engine.played(song);
    expect(timestamp).toHaveBeenCalledTimes(2);
  });

  it("is not fetched while signed out", async () => {
    engine.setCookie(null);
    expect(await engine.played(song)).toBeNull();
    expect(timestamp).not.toHaveBeenCalled();
  });
});
