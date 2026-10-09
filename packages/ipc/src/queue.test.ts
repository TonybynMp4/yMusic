import { describe, expect, it } from "vitest";

import { QueuePosition, SavedQueue } from "./queue.ts";

const song = {
  id: "yt:dQw4w9WgXcQ",
  title: "Song",
  artists: [{ name: "Someone", channelId: "UCx" }],
  album: null,
  albumId: null,
  durationMs: 213_000,
  thumbnails: [],
  isExplicit: false,
  year: null,
};

const saved = {
  items: [song],
  order: [0],
  cursor: 0,
  repeat: "off",
  shuffle: false,
  playlistId: "VLPLabc",
  shared: { account: "Tony", videoId: "dQw4w9WgXcQ", playlistId: "VLPLabc" },
};

describe("the saved queue", () => {
  it("reads back what the app writes", () => {
    expect(SavedQueue.parse(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(SavedQueue.parse({ ...saved, shared: null }).shared).toBeNull();
  });

  it("is refused when it is not a queue", () => {
    expect(SavedQueue.safeParse({ ...saved, cursor: null }).success).toBe(false);
    expect(SavedQueue.safeParse({ ...saved, items: [{ id: "nope" }] }).success).toBe(false);
  });

  it("matches the position Rust saves", () => {
    // `queue::QueuePosition` in Rust, as `queue-position.json` holds it.
    expect(QueuePosition.parse({ trackId: "yt:dQw4w9WgXcQ", positionMs: 61_500 })).toEqual({
      trackId: "yt:dQw4w9WgXcQ",
      positionMs: 61_500,
    });
  });
});
