import { describe, expect, it } from "vitest";

import { createYouTube } from "./client.ts";
import { searchSongs } from "./search.ts";

/**
 * The half the offline tests cannot cover: that InnerTube still answers, and
 * that what it sends still fits the shapes `parse.ts` describes. Opt-in,
 * because a test suite that fails when the network is down or when YouTube is
 * rate limiting is a test suite people learn to ignore.
 *
 * Run with `YTBM_NETWORK_TESTS=1 pnpm --filter @ytbm/youtube test`.
 */
const live = process.env.YTBM_NETWORK_TESTS === "1" ? describe : describe.skip;

live("search against the real InnerTube", () => {
  it("finds songs and fills in the fields the UI renders", { timeout: 30_000 }, async () => {
    const youtube = await createYouTube({ fetch: globalThis.fetch });
    const tracks = await searchSongs(youtube, "boards of canada roygbiv");

    expect(tracks.length).toBeGreaterThan(0);
    for (const track of tracks) {
      expect(track.id).toMatch(/^yt:.+/);
      expect(track.title.length).toBeGreaterThan(0);
    }

    // Not just "some rows parsed": the fields that would quietly become null if
    // youtubei.js changed its field names have to be populated on most rows.
    const withArtist = tracks.filter((t) => t.artists.length > 0);
    const withDuration = tracks.filter((t) => t.durationMs !== null);
    const withArt = tracks.filter((t) => t.thumbnails.length > 0);
    expect(withArtist.length).toBeGreaterThan(tracks.length / 2);
    expect(withDuration.length).toBeGreaterThan(tracks.length / 2);
    expect(withArt.length).toBeGreaterThan(tracks.length / 2);
  });

  it("returns nothing for a blank query without calling out", async () => {
    const youtube = await createYouTube({ fetch: globalThis.fetch });
    expect(await searchSongs(youtube, "   ")).toEqual([]);
  });
});
