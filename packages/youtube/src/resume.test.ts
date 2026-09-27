import { describe, expect, it } from "vitest";

import { serverQueueFrom } from "./resume.ts";

const text = (value: string) => ({ toString: () => value });

const row = (id: string, selected = false) => ({
  type: "PlaylistPanelVideo",
  video_id: id,
  title: text(id),
  duration: { text: "2:30", seconds: 150 },
  artists: [{ name: "Someone", channel_id: "UCx" }],
  selected,
});

describe("serverQueueFrom", () => {
  it("keeps the whole queue and points at the song that was playing", () => {
    const queue = serverQueueFrom({
      playlist_id: "RDAMVMone",
      contents: [row("one"), row("two", true), row("three")],
    });
    expect(queue?.tracks.map((t) => t.id)).toEqual(["yt:one", "yt:two", "yt:three"]);
    expect(queue?.index).toBe(1);
    expect(queue?.playlistId).toBe("RDAMVMone");
  });

  it("finds the selected song inside a wrapped row", () => {
    const queue = serverQueueFrom({
      contents: [row("one"), { type: "PlaylistPanelVideoWrapper", primary: row("two", true) }],
    });
    expect(queue?.index).toBe(1);
    expect(queue?.playlistId).toBeNull();
  });

  it("starts at the top when nothing is selected, and is null when empty", () => {
    expect(serverQueueFrom({ contents: [row("one"), row("two")] })?.index).toBe(0);
    expect(serverQueueFrom({ contents: [] })).toBeNull();
  });
});
