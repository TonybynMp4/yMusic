import { describe, expect, it } from "vitest";
import type { StreamLease, TrackId } from "@ymusic/core";

import { degradedReason } from "./engine.ts";

const lease: StreamLease = {
  trackId: "yt:SM4tQcUt_mQ" as TrackId,
  url: "https://rr5.googlevideo.com/videoplayback",
  itag: 251,
  codec: "opus",
  bitrate: 160_000,
  isPremiumFormat: false,
  loudnessDb: null,
  headers: {},
  expiresAt: null,
  playerClient: "VISIONOS",
  degraded: null,
};

describe("degradedReason", () => {
  it("names what plays and what a Premium account should get", () => {
    expect(degradedReason(lease, true)).toMatch(
      /^Playing at 160 kbps Opus instead of Premium's 256 kbps\./,
    );
  });

  it("measures a free account against Opus 251", () => {
    const aac = { ...lease, itag: 140, codec: "aac" as const, bitrate: 130_000 };
    expect(degradedReason(aac, false)).toMatch(
      /^Playing at 130 kbps AAC instead of 160 kbps Opus\./,
    );
  });
});
