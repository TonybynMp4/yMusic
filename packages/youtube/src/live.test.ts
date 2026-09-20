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

  it("searches YouTube Music, not YouTube", async () => {
    // YouTube Music and plain YouTube share the `/youtubei/v1/search`
    // endpoint and differ only by the client context in the request body, so
    // the two are indistinguishable from the outside. Without this, swapping
    // `music.search` for `search` would still compile and still return
    // plausible-looking rows — just video results instead of songs.
    const clients: string[] = [];
    const watching: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
      if (url.includes("/youtubei/v1/search")) {
        const body = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
        const text = typeof body === "string" ? body : await new Response(body).text();
        clients.push(JSON.parse(text).context?.client?.clientName);
      }
      return globalThis.fetch(input as RequestInfo, init);
    };

    const youtube = await createYouTube({ fetch: watching });
    const tracks = await searchSongs(youtube, "boards of canada roygbiv");

    expect(clients).toContain("WEB_REMIX");
    expect(clients).not.toContain("WEB");

    // The behavioural half of the same check: album is a YouTube Music
    // concept, and a plain video search would never populate it.
    expect(tracks.filter((t) => t.album !== null).length).toBeGreaterThan(0);
  }, 30_000);
});
