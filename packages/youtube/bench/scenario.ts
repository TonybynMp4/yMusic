import { videoIdFromTrackId, type Track, type VideoId } from "@ymusic/core";

import type { YouTubeEngine } from "../src/engine.ts";
import type { PlayerScript } from "../src/player-script.ts";
import { loadApp, type App } from "./app.ts";

/**
 * What the app asks of the engine during the memory harness's session
 * (`apps/desktop/src/memoryScenario.ts` on the harness branch), without the
 * waiting: the same pages, and the same calls the UI makes for them.
 *
 * The engine phases drop results as soon as they arrive, so what stays in
 * memory afterwards is the engine's own doing. The `app-` phases go through
 * the app's own caches instead (`app.ts`), and keep what the app keeps.
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
/** Songs in a long evening of skipping through a playlist: each gets a stream and a year. */
const SESSION_SONGS = 700;

/** `quick` takes seconds; `session` adds the long session, which takes about a minute. */
export const SCENARIOS = {
  quick: ["browse", "long-playlist", "playback", "player-script", "fallback", "app-browse"],
  // Signed in, without the fallback: the player script is what `WEB_REMIX`
  // adds, and `idle` gives an ended worker time to go before the next point.
  "signed-in": ["browse", "long-playlist", "playback", "player-script", "idle", "app-browse"],
  session: [
    "browse",
    "long-playlist",
    "playback",
    "player-script",
    "fallback",
    "app-browse",
    "app-session",
  ],
} as const;
export type Scenario = keyof typeof SCENARIOS;
export type Phase = (typeof SCENARIOS)[Scenario][number];

let app: App | null = null;
/** The streams the player keeps, as `usePlayer` does: for the rest of the session. */
const leases = new Map<string, unknown>();

/** Runs `phase` and says what it got, to tell a working run from one that quietly did little. */
export async function runPhase(
  engine: YouTubeEngine,
  phase: Phase,
  analyse: () => Promise<PlayerScript | null>,
): Promise<string> {
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
    case "player-script": {
      // What signing in adds before the first song: YouTube's player script,
      // analysed for the decipher code `WEB_REMIX` needs. The fallback below
      // reuses it, as the engine does.
      const script = await analyse();
      if (script === null) return "skipped";
      return `player ${script.playerId}, ${Math.round(script.data.output.length / 1024)} KB extracted`;
    }
    case "idle":
      await Bun.sleep(5_000);
      return "5 s";
    case "fallback": {
      // The client the player retries a stream on when mpv cannot play it:
      // a PO token from BotGuard, and the player script's decipher code.
      const ids = (await wholePlaylist(engine, PLAY_PLAYLIST)).slice(0, TRACKS);
      let resolved = 0;
      for (const id of ids) {
        if (await engine.resolve(id, { refused: "VISIONOS" }).catch(() => null)) resolved++;
      }
      return `${resolved} of ${ids.length} streams resolved on the fallback client`;
    }
    case "app-browse": {
      // An evening of browsing: every page above, opened and left in turn,
      // the long playlist first, so the oldest is the biggest.
      app ??= await loadApp(engine);
      const routes = [
        { kind: "playlist", id: LONG_PLAYLIST },
        ...ARTISTS.map((id) => ({ kind: "artist", id })),
        ...ALBUMS.map((id) => ({ kind: "album", id })),
        ...PLAYLISTS.map((id) => ({ kind: "playlist", id })),
      ] as const;
      let loaded = 0;
      for (const route of routes) if (await app.settledPage(route).catch(() => null)) loaded++;
      return `${loaded} of ${routes.length} pages`;
    }
    case "app-session": {
      // Hours of skipping through the long playlist: each song played gets its
      // stream, and NowPlaying looks up its year, even when skipped at once.
      // The streams are kept as the player keeps them; it only drops expired
      // ones, and a stream lasts about six hours.
      app ??= await loadApp(engine);
      const page = await app.settledPage({ kind: "playlist", id: LONG_PLAYLIST });
      if (page.kind !== "playlist") throw new Error("not a playlist");
      const songs = page.page.tracks.filter((track) => track.year === null).slice(0, SESSION_SONGS);
      const lookups = app.calls("songYear");
      for (const track of songs) {
        app.useSongYear(track);
        const videoId = videoIdFromTrackId(track.id);
        const lease = videoId && (await app.engine.resolve(videoId).catch(() => null));
        if (lease) leases.set(track.id, lease);
        await app.settle();
        app.unmount();
      }
      return `${leases.size} of ${songs.length} streams resolved, ${app.calls("songYear") - lookups} years looked up`;
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
