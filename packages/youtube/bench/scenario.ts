import { videoIdFromTrackId, type Track, type VideoId } from "@ymusic/core";

import type { YouTubeEngine } from "../src/engine.ts";

/**
 * What the app asks of the engine during the memory harness's session
 * (`apps/desktop/src/memoryScenario.ts` on the harness branch), without the
 * waiting: the same pages, and the same calls the UI makes for them.
 *
 * Results are dropped as soon as they arrive. What stays in memory afterwards
 * is the engine's own doing, not the UI's.
 */

const ARTISTS = [
  "UCidyEq0ZC6rcqZmwKt_g_2g",
  "UCRr1xG_2WIDs18a6cIiCxeA",
  "UCr_iyUANcn9OX_yy9piYoLw",
  "UCWmnkYUzoOiOztmPBhIlZjg",
  "UCr1uxon7aFztw_dnrau0TDA",
  "UCWBqhkfK4YT2OI3mJRQnNXg",
  "UCweAx0TIRdAylp6G1nviqbQ",
  "UCH_Q3OLUXLZNF0qmnY3bCXg",
  "UC2XdaAVUannpujzv32jcouQ",
  "UCFtSXTlIMFFkyJbHO3V5b7A",
];
const ALBUMS = [
  "MPREb_pFcE2q6FI5P",
  "MPREb_OgeEnoHTsCm",
  "MPREb_E7NpKw54NIT",
  "MPREb_wfzv7bW99ZR",
  "MPREb_bLGnHuyrAV6",
  "MPREb_GvPMXBmBE6G",
  "MPREb_cxrBkIKSmas",
  "MPREb_zD5pn1gZFKx",
  "MPREb_ztv6DhWg3Rn",
  "MPREb_AGVqpuBVvmr",
];
const PLAYLISTS = [
  "OLAK5uy_nLnSi-qtDKzGBDxmyDXnM0Ce9fnHlzXeM",
  "OLAK5uy_lNVBcjNtiCwq-n95uoxJ-Gd4vsfMkyZNs",
  "OLAK5uy_mk1BEhFnj4bSlQ2UOpykWxi5amu08QdG8",
  "OLAK5uy_n5RQmz9UnmF5Rs5sOZVfNhdifTC6kTC4I",
  "OLAK5uy_ln86IRT62PQhmgXcnpvWmkiYvj-k30RNE",
  "PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj",
  "PLw-VjHDlEOgvtnnnqWlTqByAtC7tXBg6D",
  "PL3oW2tjiIxvQW6c-4Iry8Bpp3QId40S5S",
  "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
  "PLGBuKfnErZlD_VXiQ8dkn6wdEYHbC3u0i",
];
/** About a thousand rows, the size of a long Liked Music. */
const LONG_PLAYLIST = "PLZzyUfYacyoJWuK0dFCjcocJQrIGZuxqj";
/** What is played from: another long one. */
const PLAY_PLAYLIST = "PLU0CpsviHWH2GP5FsdgOLYJ9hMLtclNpz";
const TRACKS = 20;

export const PHASES = ["browse", "long-playlist", "playback"] as const;
export type Phase = (typeof PHASES)[number];

/** Runs `phase` and says what it got, to tell a working run from one that quietly did little. */
export async function runPhase(engine: YouTubeEngine, phase: Phase): Promise<string> {
  switch (phase) {
    case "browse": {
      let rows = 0;
      for (const id of ARTISTS) await engine.artist(id);
      for (const id of ALBUMS) rows += (await engine.album(id)).tracks.length;
      for (const id of PLAYLISTS) rows += (await wholePlaylist(engine, id)).length;
      return `${ARTISTS.length} artists, ${rows} album and playlist rows`;
    }
    case "long-playlist":
      return `${(await wholePlaylist(engine, LONG_PLAYLIST)).length} rows`;
    case "playback": {
      const ids = (await wholePlaylist(engine, PLAY_PLAYLIST)).slice(0, TRACKS);
      let resolved = 0;
      for (const id of ids) {
        // Each song the player starts: its stream, and the year NowPlaying shows.
        if (await engine.resolve(id).catch(() => null)) resolved++;
        await engine.songYear(id).catch(() => null);
      }
      return `${resolved} of ${ids.length} streams resolved`;
    }
  }
}

/** Every page of a playlist, as `useBrowse` loads it; returns its video ids. */
async function wholePlaylist(engine: YouTubeEngine, id: string): Promise<VideoId[]> {
  const first = await engine.playlist(id);
  const ids = videoIds(first.page.tracks);
  for (let more = first.more; more !== null; ) {
    const next = await engine.playlistMore(more);
    ids.push(...videoIds(next.tracks));
    more = next.more;
  }
  return ids;
}

function videoIds(tracks: Track[]): VideoId[] {
  return tracks.flatMap((track) => videoIdFromTrackId(track.id) ?? []);
}
