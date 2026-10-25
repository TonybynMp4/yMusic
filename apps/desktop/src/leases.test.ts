import { describe, expect, it } from "vitest";
import { STREAM_LEASE_SAFETY_MARGIN_MS, type StreamLease, type TrackId } from "@ymusic/core";

import { keepLease } from "./leases.ts";

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

const yt = (id: string) => `yt:${id}` as TrackId;

describe("keepLease", () => {
  it("stores a lease that will expire", () => {
    const leases = new Map<TrackId, StreamLease>();
    keepLease(leases, yt("a"), lease("yt:a", NOW + 6 * HOUR), NOW);
    expect([...leases.keys()]).toEqual([yt("a")]);
  });

  it("drops the leases that are no longer usable as a new one arrives", () => {
    const leases = new Map<TrackId, StreamLease>([
      [yt("expired"), lease("yt:expired", NOW - HOUR)],
      [yt("in-margin"), lease("yt:in-margin", NOW + STREAM_LEASE_SAFETY_MARGIN_MS)],
      [yt("fresh"), lease("yt:fresh", NOW + 2 * HOUR)],
    ]);
    keepLease(leases, yt("new"), lease("yt:new", NOW + 6 * HOUR), NOW);
    expect([...leases.keys()]).toEqual([yt("fresh"), yt("new")]);
  });

  it("does not store a lease that never expires, which pruning could never drop", () => {
    const leases = new Map<TrackId, StreamLease>();
    const local = "local:/music/song.flac" as TrackId;
    keepLease(leases, local, lease(local, null), NOW);
    expect(leases.size).toBe(0);
  });

  it("still prunes when the new lease is not stored", () => {
    const leases = new Map<TrackId, StreamLease>([[yt("old"), lease("yt:old", NOW - HOUR)]]);
    const local = "local:/music/song.flac" as TrackId;
    keepLease(leases, local, lease(local, null), NOW);
    expect(leases.size).toBe(0);
  });

  it("replaces what was stored for the song", () => {
    const leases = new Map<TrackId, StreamLease>([[yt("a"), lease("yt:a", NOW + HOUR)]]);
    keepLease(leases, yt("a"), lease("yt:a", NOW + 6 * HOUR), NOW);
    expect(leases.get(yt("a"))?.expiresAt).toBe(NOW + 6 * HOUR);

    keepLease(leases, yt("a"), lease("yt:a", null), NOW);
    expect(leases.has(yt("a"))).toBe(false);
  });
});
