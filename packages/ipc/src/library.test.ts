import { isLeaseUsable, StreamLease, TrackId } from "@ytbm/core";
import { describe, expect, it } from "vitest";

import { ScanReport } from "./library.ts";

/**
 * Contract tests for the Rust boundary.
 *
 * The payloads below are the shapes `tests/commands.rs` asserts the Rust
 * commands emit. Pinning them here means a serde rename on one side fails a
 * test rather than showing up as a blank row in the UI.
 */

const localLease = {
  trackId: "local:9f8a7b6c5d4e3f2a1b0c9d",
  url: "file:///home/tony/Music/Nebula/01.flac",
  itag: null,
  codec: "flac",
  bitrate: 1024,
  isPremiumFormat: false,
  headers: {},
  expiresAt: null,
};

/** What the YouTube resolver will return, for comparison. */
const remoteLease = {
  trackId: "yt:dQw4w9WgXcQ",
  url: "https://rr3---sn-x.googlevideo.com/videoplayback?expire=1",
  itag: 251,
  codec: "opus",
  bitrate: 160000,
  isPremiumFormat: false,
  headers: { "User-Agent": "YTBM/0.1", Cookie: "a=1, b=2" },
  expiresAt: Date.now() + 6 * 60 * 60 * 1000,
};

describe("StreamLease", () => {
  it("accepts a local file lease", () => {
    const parsed = StreamLease.parse(localLease);
    expect(parsed.expiresAt).toBeNull();
    expect(parsed.headers).toEqual({});
  });

  it("accepts a remote lease through the same schema", () => {
    expect(() => StreamLease.parse(remoteLease)).not.toThrow();
  });

  it("treats a local lease as usable forever", () => {
    const parsed = StreamLease.parse(localLease);
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

describe("ScanReport", () => {
  it("parses a report with unreadable files", () => {
    const report = ScanReport.parse({
      added: 2,
      updated: 0,
      unchanged: 41,
      removed: 1,
      failed: [{ path: "/music/broken.mp3", reason: "invalid data" }],
    });
    expect(report.failed[0]?.reason).toBe("invalid data");
  });

  it("requires the failure list rather than defaulting it away", () => {
    expect(() => ScanReport.parse({ added: 0, updated: 0, unchanged: 0, removed: 0 })).toThrow();
  });
});
