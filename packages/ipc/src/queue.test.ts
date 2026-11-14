import { describe, expect, it } from "vitest";

import { SavedQueue } from "./queue.ts";

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
  source: { playlistId: "VLPLabc", ids: [song.id] },
  from: { title: "Playlist", device: "From your Android device" },
  shared: { account: "Tony", videoId: "dQw4w9WgXcQ", playlistId: "VLPLabc" },
};

describe("the saved queue", () => {
  it("reads back what the app writes", () => {
    expect(SavedQueue.parse(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(SavedQueue.parse({ ...saved, shared: null }).shared).toBeNull();
  });

  it("reads a queue saved before it named its source", () => {
    const { from: _, ...older } = saved;
    expect(SavedQueue.parse(older).from).toBeNull();
  });

  it("is refused when it is not a queue", () => {
    expect(SavedQueue.safeParse({ ...saved, cursor: null }).success).toBe(false);
    expect(SavedQueue.safeParse({ ...saved, items: [{ id: "nope" }] }).success).toBe(false);
  });
});
