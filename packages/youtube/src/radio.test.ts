import { describe, expect, it } from "vitest";
import type { VideoId } from "@ymusic/core";

import { radioFrom } from "./radio.ts";

/** Stands in for youtubei.js's `Text`, which is read through `toString`. */
const text = (value: string) => ({ toString: () => value });

const row = (id: string, title: string) => ({
  type: "PlaylistPanelVideo",
  video_id: id,
  title: text(title),
  duration: { text: "2:30", seconds: 150 },
  album: { id: "MPREb_x", name: "An Album" },
  artists: [{ name: "Someone", channel_id: "UCx" }],
  thumbnail: [{ url: "https://i.ytimg.com/vi/x/sddefault.jpg", width: 640, height: 480 }],
});

describe("radioFrom", () => {
  it("lifts panel rows into tracks and leaves out the seed", () => {
    const tracks = radioFrom(
      { contents: [row("seed", "Seed"), row("one", "One"), row("two", "Two")] },
      "seed" as VideoId,
    );
    expect(tracks.map((t) => t.id)).toEqual(["yt:one", "yt:two"]);
    expect(tracks[0]!.title).toBe("One");
    expect(tracks[0]!.album).toBe("An Album");
    expect(tracks[0]!.durationMs).toBe(150_000);
  });

  it("unwraps wrapped rows and drops repeats", () => {
    const tracks = radioFrom(
      {
        contents: [
          { type: "PlaylistPanelVideoWrapper", primary: row("one", "One") },
          row("one", "One again"),
          { type: "AutomixPreviewVideo" },
        ],
      },
      "seed" as VideoId,
    );
    expect(tracks.map((t) => t.title)).toEqual(["One"]);
  });
});
