import type { VideoId } from "@ymusic/core";
import { describe, expect, it } from "vitest";

import { shareTargets, shareUrl, type Shared } from "./share.ts";

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

describe("shareTargets", () => {
  it("encodes the link and the title", () => {
    const targets = shareTargets("https://music.youtube.com/watch?v=a&b", "Rock & roll");
    expect(Object.fromEntries(targets.map((t) => [t.id, t.url]))).toMatchInlineSnapshot(`
      {
        "email": "mailto:?body=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3Da%26b&subject=Rock%20%26%20roll",
        "facebook": "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3Da%26b",
        "reddit": "https://www.reddit.com/submit?url=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3Da%26b&title=Rock%20%26%20roll",
        "telegram": "https://t.me/share/url?url=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3Da%26b&text=Rock%20%26%20roll",
        "whatsapp": "https://wa.me/?text=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3Da%26b",
        "x": "https://x.com/intent/tweet?url=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3Da%26b&text=Rock%20%26%20roll",
      }
    `);
  });

  it("leaves the title out when there is none", () => {
    const x = shareTargets("https://music.youtube.com/channel/UCabc", null).find(
      (t) => t.id === "x",
    );
    expect(x?.url).toBe(
      "https://x.com/intent/tweet?url=https%3A%2F%2Fmusic.youtube.com%2Fchannel%2FUCabc",
    );
  });
});
