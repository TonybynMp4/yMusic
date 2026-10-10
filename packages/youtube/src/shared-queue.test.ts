import { describe, expect, it } from "vitest";
import type { Track, TrackId, VideoId } from "@ymusic/core";

import { isSharedQueue } from "./shared-queue.ts";

const track = (id: string): Track => ({
  id: `yt:${id}` as TrackId,
  title: id,
  artists: [],
  album: null,
  albumId: null,
  durationMs: 150_000,
  thumbnails: [],
  isExplicit: false,
  year: null,
});

const server = (selected: number, playlistId: string | null) => ({
  tracks: ["one", "two", "three"].map(track),
  index: selected,
  playlistId,
});

const shared = (videoId: string, playlistId: string | null) => ({
  videoId: videoId as VideoId,
  playlistId,
});

describe("isSharedQueue", () => {
  it("matches the song and playlist this device wrote", () => {
    expect(isSharedQueue(server(1, "PLabc"), shared("two", "VLPLabc"))).toBe(true);
    expect(isSharedQueue(server(1, "PLabc"), shared("two", "PLabc"))).toBe(true);
  });

  it("matches a song shared on its own against its radio", () => {
    expect(isSharedQueue(server(0, "RDAMVMone"), shared("one", null))).toBe(true);
    expect(isSharedQueue(server(0, null), shared("one", null))).toBe(true);
  });

  it("does not match once another device has moved on", () => {
    expect(isSharedQueue(server(2, "PLabc"), shared("two", "PLabc"))).toBe(false);
    expect(isSharedQueue(server(1, "PLother"), shared("two", "PLabc"))).toBe(false);
    expect(isSharedQueue(server(1, "PLabc"), shared("two", null))).toBe(false);
    expect(isSharedQueue(server(1, "RDAMVMtwo"), shared("two", "PLabc"))).toBe(false);
  });
});
