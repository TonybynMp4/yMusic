import { describe, expect, it } from "vitest";
import type { VideoId } from "@ytbm/core";

import { getAlbum, getArtist, getPlaylist } from "./browse.ts";
import { createPlayer, createYouTube } from "./client.ts";
import { searchSongs } from "./search.ts";
import { NotPlayableError, resolveStream } from "./stream.ts";

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
    // plausible-looking rows, just video results instead of songs.
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

live("stream resolution against the real player endpoint", () => {
  // Boards of Canada, "Roygbiv". A fixed id rather than a search result, so a
  // failure here means resolution broke and not that search returned something
  // different today.
  const VIDEO_ID = "SM4tQcUt_mQ" as VideoId;

  it("resolves a video id to a lease that names real audio", async () => {
    const youtube = await createPlayer({ fetch: globalThis.fetch });
    const lease = await resolveStream(youtube, VIDEO_ID);

    expect(lease.trackId).toBe(`yt:${VIDEO_ID}`);
    expect(lease.url).toMatch(/^https:\/\/[^/]*googlevideo\.com\//);
    expect(lease.codec).not.toBe("unknown");
    expect(lease.bitrate).toBeGreaterThan(0);
    // Six hours when measured. Asserting only that it is in the future keeps
    // the test about the lease being usable rather than about YouTube's TTL.
    expect(lease.expiresAt).toBeGreaterThan(Date.now());
  }, 60_000);

  /**
   * The check the offline tests structurally cannot make, and the one that
   * actually decides whether a track plays.
   *
   * mpv opens a stream with an open-ended range and re-asks the same way on
   * every seek. Most InnerTube clients hand back URLs that answer those with
   * 403 while still serving a bounded range perfectly, so a lease can look
   * completely correct, pass every test above, and produce a player that sits
   * at zero seconds with no error. This asserts the two requests mpv really
   * makes, against the URL we really hand it.
   */
  it("hands back a URL that answers the requests mpv makes", async () => {
    const youtube = await createPlayer({ fetch: globalThis.fetch });
    const lease = await resolveStream(youtube, VIDEO_ID);

    const opening = await globalThis.fetch(lease.url, { headers: { Range: "bytes=0-" } });
    opening.body?.cancel();
    expect(opening.status).toBe(206);

    const seek = await globalThis.fetch(lease.url, { headers: { Range: "bytes=500000-" } });
    seek.body?.cancel();
    expect(seek.status).toBe(206);
  }, 60_000);

  it("reports why a track cannot be played instead of failing obscurely", async () => {
    const youtube = await createPlayer({ fetch: globalThis.fetch });

    await expect(resolveStream(youtube, "aaaaaaaaaaa" as VideoId)).rejects.toThrow(
      NotPlayableError,
    );
  }, 60_000);
});

live("browse pages against the real InnerTube", () => {
  // Boards of Canada, and "Music Has The Right To Children": long-lived ids.
  const artistId = "UCidyEq0ZC6rcqZmwKt_g_2g";

  it("opens an artist, one of its albums, and its top-songs playlist", { timeout: 60_000 }, async () => {
    const youtube = await createYouTube({ fetch: globalThis.fetch });

    const artist = await getArtist(youtube, artistId);
    expect(artist.name).toBe("Boards of Canada");
    expect(artist.thumbnails.length).toBeGreaterThan(0);
    expect(artist.topSongs.length).toBeGreaterThan(0);
    const albums = artist.shelves.flatMap((shelf) => shelf.cards).filter((c) => c.kind === "album");
    expect(albums.length).toBeGreaterThan(0);
    expect(albums[0]!.id).toMatch(/^MPREb_/);

    const album = await getAlbum(youtube, albums[0]!.id);
    expect(album.title.length).toBeGreaterThan(0);
    expect(album.artists.map((a) => a.channelId)).toContain(artistId);
    expect(album.tracks.length).toBeGreaterThan(0);
    for (const track of album.tracks) {
      // Filled in from the header, which is the whole point of `albumFrom`.
      expect(track.thumbnails.length).toBeGreaterThan(0);
      expect(track.artists.length).toBeGreaterThan(0);
      expect(track.albumId).toBe(album.id);
    }

    expect(artist.topSongsPlaylistId).not.toBeNull();
    const playlist = await getPlaylist(youtube, artist.topSongsPlaylistId!);
    expect(playlist.title.length).toBeGreaterThan(0);
    expect(playlist.tracks.length).toBeGreaterThan(artist.topSongs.length);
  });

  it("links search results to their album", { timeout: 30_000 }, async () => {
    const youtube = await createYouTube({ fetch: globalThis.fetch });
    const tracks = await searchSongs(youtube, "boards of canada roygbiv");
    expect(tracks.filter((t) => t.albumId?.startsWith("MPREb_")).length).toBeGreaterThan(0);
  });
});
