import type { VideoId } from "@ymusic/core";
import { describe, expect, it } from "vitest";

import { shareUrl, type Shared } from "./share.ts";

describe("shareUrl", () => {
  it.each<[string, Shared, string | null]>([
    [
      "a song",
      { kind: "song", videoId: "dQw4w9WgXcQ" as VideoId },
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    ["an album", { kind: "album", id: "MPREb_abc" }, "https://music.youtube.com/browse/MPREb_abc"],
    ["an artist", { kind: "artist", id: "UCabc" }, "https://music.youtube.com/channel/UCabc"],
    [
      "a playlist",
      { kind: "playlist", id: "PLabc" },
      "https://music.youtube.com/playlist?list=PLabc",
    ],
    ["Liked Music", { kind: "playlist", id: "LM" }, null],
  ])("links %s", (_, shared, url) => {
    expect(shareUrl(shared)).toBe(url);
  });
});
