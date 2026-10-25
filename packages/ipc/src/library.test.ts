import { isLeaseUsable, StreamLease, TrackId } from "@ymusic/core";
import { describe, expect, it } from "vitest";

import type { LocalLease } from "./bindings.ts";
import { toStreamLease } from "./library.ts";

/**
 * The local lease is typed by the bindings generated from Rust, so these check
 * that what Rust sends lifts into a lease core accepts.
 */

const localLease: LocalLease = {
  trackId: "local:9f8a7b6c5d4e3f2a1b0c9d",
  url: "file:///home/tony/Music/Nebula/01.flac",
  itag: null,
  codec: "flac",
  bitrate: 1024,
  isPremiumFormat: false,
  loudnessDb: null,
  headers: {},
  expiresAt: null,
  playerClient: null,
  degraded: null,
};

/** What the YouTube resolver will return, for comparison. */
const remoteLease = {
  trackId: "yt:dQw4w9WgXcQ",
  url: "https://rr3---sn-x.googlevideo.com/videoplayback?expire=1",
  itag: 251,
  codec: "opus",
  bitrate: 160000,
  isPremiumFormat: false,
  loudnessDb: null,
  headers: { "User-Agent": "YMUSIC/0.1", Cookie: "a=1, b=2" },
  expiresAt: Date.now() + 6 * 60 * 60 * 1000,
  playerClient: "VISIONOS",
  degraded: null,
};

describe("StreamLease", () => {
  it("accepts a local file lease", () => {
    const parsed = StreamLease.parse(toStreamLease(localLease));
    expect(parsed.expiresAt).toBeNull();
    expect(parsed.headers).toEqual({});
  });

  it("accepts a remote lease through the same schema", () => {
    expect(() => StreamLease.parse(remoteLease)).not.toThrow();
  });

  it("treats a local lease as usable forever", () => {
    const parsed = toStreamLease(localLease);
    expect(isLeaseUsable(parsed, Date.now())).toBe(true);
    expect(isLeaseUsable(parsed, Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("rejects a remote lease inside the safety margin", () => {
    const now = Date.now();
    const expiring = StreamLease.parse({ ...remoteLease, expiresAt: now + 60_000 });
    expect(isLeaseUsable(expiring, now)).toBe(false);
  });

  it("rejects an id that is not namespaced by source", () => {
    expect(() => StreamLease.parse({ ...localLease, trackId: "dQw4w9WgXcQ" })).toThrow();
  });
});

describe("TrackId", () => {
  it("keeps the two sources from colliding", () => {
    expect(TrackId.parse("yt:abc")).not.toBe(TrackId.parse("local:abc"));
  });
});
