import { describe, expect, it, vi } from "vitest";
import { STREAM_LEASE_SAFETY_MARGIN_MS, type StreamLease, type TrackId } from "@ymusic/core";

import { leaseOptions, leaseStaleTime } from "./leases.ts";
import { queryClient } from "./query.ts";

const resolveTrack = vi.hoisted(() => vi.fn<() => Promise<StreamLease>>());
vi.mock("./engine.ts", () => ({ engine: {} }));
vi.mock("./resolve.ts", () => ({ resolveTrack }));

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

function lease(id: string, expiresAt: number | null): StreamLease {
  return {
    trackId: id as TrackId,
    url: `https://rr5.googlevideo.com/videoplayback?id=${id}`,
    itag: 251,
    codec: "opus",
    bitrate: 160_000,
    isPremiumFormat: false,
    loudnessDb: null,
    headers: {},
    expiresAt,
    playerClient: "VISIONOS",
    degraded: null,
  };
}

describe("leaseStaleTime", () => {
  it("keeps a lease until the safety margin before it expires", () => {
    expect(leaseStaleTime(lease("yt:a", NOW + 6 * HOUR), NOW)).toBe(
      6 * HOUR - STREAM_LEASE_SAFETY_MARGIN_MS,
    );
  });

  it("treats a lease inside the margin as stale", () => {
    expect(leaseStaleTime(lease("yt:a", NOW + STREAM_LEASE_SAFETY_MARGIN_MS / 2), NOW)).toBe(0);
  });

  it("never expires a local file's lease", () => {
    expect(leaseStaleTime(lease("local:a", null), NOW)).toBe(Infinity);
  });

  it("fetches when there is no lease yet", () => {
    expect(leaseStaleTime(undefined, NOW)).toBe(0);
  });
});

describe("a lease in the cache", () => {
  const id = "yt:a" as TrackId;

  it("is handed out again while usable, per quality", async () => {
    resolveTrack.mockImplementation(async () => lease("yt:a", Date.now() + 6 * HOUR));
    await queryClient.fetchQuery(leaseOptions("high", id));
    await queryClient.fetchQuery(leaseOptions("high", id));
    expect(resolveTrack).toHaveBeenCalledTimes(1);
    await queryClient.fetchQuery(leaseOptions("low", id));
    expect(resolveTrack).toHaveBeenCalledTimes(2);
  });

  it("is resolved again once it is about to expire", async () => {
    queryClient.clear();
    resolveTrack.mockReset();
    resolveTrack.mockImplementation(async () => lease("yt:a", Date.now() + 60_000));
    await queryClient.fetchQuery(leaseOptions("high", id));
    await queryClient.fetchQuery(leaseOptions("high", id));
    expect(resolveTrack).toHaveBeenCalledTimes(2);
  });
});
