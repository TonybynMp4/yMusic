import type { Track } from "@ytbm/core";
import { TrackId } from "@ytbm/core";
import { describe, expect, it } from "vitest";

import { localPathFromArtUrl } from "./library.ts";
import { MediaKeyEvent, toMediaTrack } from "./media.ts";

const base: Track = {
  id: TrackId.parse("yt:dQw4w9WgXcQ"),
  title: "Song",
  artists: [
    { name: "A", channelId: null },
    { name: "B", channelId: null },
  ],
  album: null,
  albumId: null,
  durationMs: 200_000,
  thumbnails: [
    { url: "https://i.ytimg.com/small.jpg", width: 60, height: 60 },
    { url: "https://i.ytimg.com/large.jpg", width: 544, height: 544 },
  ],
  isExplicit: false,
};

describe("toMediaTrack", () => {
  it("sends the largest remote thumbnail as a URL", () => {
    const media = toMediaTrack(base, null);
    expect(media.coverUrl).toBe("https://i.ytimg.com/large.jpg");
    expect(media.coverPath).toBeNull();
    expect(media.artist).toBe("A, B");
    expect(media.durationMs).toBe(200_000);
  });

  it("sends a local cover as a path, which is all the OS can open", () => {
    const path = "/home/me/.cache/ytbm/art/my cover.jpg";
    const media = toMediaTrack(
      {
        ...base,
        thumbnails: [
          { url: `asset://localhost/${encodeURIComponent(path)}`, width: 300, height: 300 },
        ],
      },
      null,
    );
    expect(media.coverPath).toBe(path);
    expect(media.coverUrl).toBeNull();
  });

  it("prefers the duration mpv measured over the catalogue's", () => {
    expect(toMediaTrack(base, 201_500).durationMs).toBe(201_500);
  });
});

describe("localPathFromArtUrl", () => {
  it("reads both spellings convertFileSrc produces", () => {
    const windowsPath = "C:\\Users\\Me Too\\art.jpg";
    expect(localPathFromArtUrl(`http://asset.localhost/${encodeURIComponent(windowsPath)}`)).toBe(
      windowsPath,
    );
    expect(localPathFromArtUrl("asset://localhost/%2Ftmp%2Fa.jpg")).toBe("/tmp/a.jpg");
  });

  it("leaves other URLs alone", () => {
    expect(localPathFromArtUrl("https://i.ytimg.com/large.jpg")).toBeNull();
  });
});

describe("MediaKeyEvent", () => {
  // The shapes Rust's `MediaKeyEvent` serialises to; a rename on either side
  // fails here instead of as a media key that silently does nothing.
  it.each([
    { type: "toggle" },
    { type: "seekBy", offsetMs: -10_000 },
    { type: "setPosition", positionMs: 42_000 },
    { type: "setVolume", volume: 0.5 },
  ])("parses %o", (event) => {
    expect(MediaKeyEvent.safeParse(event).success).toBe(true);
  });
});
