import { invoke } from "@tauri-apps/api/core";
import type { Track } from "@ymusic/core";

import { settledPage, type View } from "./useBrowse.ts";
import type { PlayFrom } from "./usePlayer.ts";

/**
 * The memory harness's scripted session (`scripts/memory`, `docs/memory.md`).
 *
 * It drives the app through its own navigation and player, on a fixed
 * timeline, so two builds can be measured doing the same things. Only builds
 * made with `VITE_MEMORY_SCENARIO` contain it. Each phase is reported to the
 * runner through `memory_mark`, which only exists in the `memory-scenario`
 * build of the core, and `done` quits the app.
 */

/** What the scenario needs of the app, read fresh at every step. */
export interface ScenarioControls {
  go: (view: View) => void;
  search: (query: string) => void;
  playTrack: (tracks: Track[], id: Track["id"], from?: PlayFrom) => void;
  setVolume: (fraction: number) => void;
  seek: (positionMs: number) => void;
  next: () => void;
  trackId: string | null;
  status: string;
  durationMs: number | null;
  signedIn: boolean;
}

/** Ten artists, one album of each and each one's songs list. */
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
/** What is played from: another long one, so the queue is long too. */
const PLAY_PLAYLIST = "PLU0CpsviHWH2GP5FsdgOLYJ9hMLtclNpz";

const IDLE_START_MS = 60_000;
const PAGE_MS = 5_000;
const TRACKS = 20;
/** Played before seeking, so each track streams for a while. */
const LISTEN_MS = 10_000;
/** Left before the end when seeking, so the change to the next is a real one. */
const TAIL_MS = 5_000;
const IDLE_END_MS = 120_000;
/** Longer than any track takes to start; past it the track is skipped. */
const STALL_MS = 60_000;

/** The tray scenario: shorter before the tray, since the tray is what it measures. */
const TRAY_IDLE_START_MS = 30_000;
const TRAY_PAGES = 4;
const TRAY_QUERY = "daft punk";
const TRAY_SEARCH_MS = 10_000;
/** With the window open, before and after the tray, to compare the tray with. */
const TRAY_VISIBLE_MS = 60_000;
const TRAY_HIDDEN_S = 360;
/** One song change per this long, in every phase that is measured. */
const TRAY_ADVANCE_S = 60;

let started = false;

export async function runMemoryScenario(controls: () => ScenarioControls): Promise<void> {
  // StrictMode mounts twice in development; one session is the point.
  if (started) return;
  started = true;
  if (!(await mark("start"))) return;
  try {
    const scenario = await invoke<string>("memory_scenario");
    await (scenario === "tray" ? traySession(controls) : session(controls));
  } catch (error) {
    console.error("memory scenario failed", error);
    await mark(`error ${error instanceof Error ? error.message : String(error)}`);
  }
  await mark("done");
}

async function session(controls: () => ScenarioControls): Promise<void> {
  // Muted rather than paused: mpv still decodes everything.
  controls().setVolume(0);

  await mark("idle");
  await sleep(IDLE_START_MS);
  // Checked once the session has had time to load, so a signed-in run whose
  // saved session no longer works shows in the report.
  await mark(controls().signedIn ? "account signed-in" : "account signed-out");

  await mark("browse");
  const pages: View[] = [
    ...ARTISTS.map((id) => ({ kind: "artist", id }) as const),
    ...ALBUMS.map((id) => ({ kind: "album", id }) as const),
    ...PLAYLISTS.map((id) => ({ kind: "playlist", id }) as const),
  ];
  for (const page of pages) {
    controls().go(page);
    await sleep(PAGE_MS);
  }

  await mark("long-playlist");
  controls().go({ kind: "playlist", id: LONG_PLAYLIST });
  await settledPage({ kind: "playlist", id: LONG_PLAYLIST });

  await mark("playback");
  controls().go({ kind: "playlist", id: PLAY_PLAYLIST });
  const page = await settledPage({ kind: "playlist", id: PLAY_PLAYLIST });
  if (page.kind !== "playlist" || page.page.tracks.length === 0) {
    throw new Error("the playlist to play from is empty");
  }
  const tracks = page.page.tracks;
  controls().playTrack(tracks, tracks[0]!.id, { kind: "playlist", id: PLAY_PLAYLIST, title: page.page.title });
  for (let played = 0; played < TRACKS; played++) {
    const current = await until(() => {
      const c = controls();
      return c.status === "playing" && c.trackId !== null ? c.trackId : null;
    }, STALL_MS);
    if (current === null) {
      await mark(`stall ${controls().trackId ?? "none"}`);
      controls().next();
      continue;
    }
    await sleep(LISTEN_MS);
    const { durationMs } = controls();
    if (durationMs !== null && durationMs > LISTEN_MS + TAIL_MS) {
      controls().seek(durationMs - TAIL_MS);
    } else {
      controls().next();
    }
    const moved = await until(() => (controls().trackId !== current ? true : null), STALL_MS);
    if (moved === null) {
      await mark(`stuck ${current}`);
      controls().next();
    }
  }

  await mark("idle-end");
  await sleep(IDLE_END_MS);
}

/**
 * What the app costs in the tray: a queue playing, some pages and a search in
 * the page's caches, then the window closed to the tray, then shown again.
 * The core does the hiding, the waiting and the showing (`memory_tray`), and
 * marks `tray-hide` and `tray-show` itself.
 */
async function traySession(controls: () => ScenarioControls): Promise<void> {
  controls().setVolume(0);

  await mark("idle");
  await sleep(TRAY_IDLE_START_MS);
  await mark(controls().signedIn ? "account signed-in" : "account signed-out");

  await mark("playback");
  controls().go({ kind: "playlist", id: PLAY_PLAYLIST });
  const page = await settledPage({ kind: "playlist", id: PLAY_PLAYLIST });
  if (page.kind !== "playlist" || page.page.tracks.length === 0) {
    throw new Error("the playlist to play from is empty");
  }
  const tracks = page.page.tracks;
  controls().playTrack(tracks, tracks[0]!.id, {
    kind: "playlist",
    id: PLAY_PLAYLIST,
    title: page.page.title,
  });
  const playing = await until(() => (controls().status === "playing" ? true : null), STALL_MS);
  if (playing === null) throw new Error("the first song did not start");

  await mark("browse");
  const pages: View[] = [
    ...ARTISTS.slice(0, TRAY_PAGES).map((id) => ({ kind: "artist", id }) as const),
    ...ALBUMS.slice(0, TRAY_PAGES).map((id) => ({ kind: "album", id }) as const),
    ...PLAYLISTS.slice(0, TRAY_PAGES).map((id) => ({ kind: "playlist", id }) as const),
  ];
  for (const next of pages) {
    controls().go(next);
    await sleep(PAGE_MS);
  }

  await mark("search");
  controls().search(TRAY_QUERY);
  await sleep(TRAY_SEARCH_MS);

  await mark("visible");
  await visibleMinute();

  // The setting's own command, which adds the tray icon; without the icon the
  // app would quit on close, and `memory_tray` refuses to close.
  await invoke("settings_set", { patch: { closeToTray: true } });
  await invoke("memory_tray", { hiddenSecs: TRAY_HIDDEN_S, advanceSecs: TRAY_ADVANCE_S });

  await visibleMinute();
}

/** A minute with the window open and one song change in the middle of it. */
async function visibleMinute(): Promise<void> {
  await sleep(TRAY_VISIBLE_MS / 2);
  await invoke("memory_skip");
  await sleep(TRAY_VISIBLE_MS / 2);
}

/** False when the app was opened only to sign in, with no scenario to run. */
function mark(phase: string): Promise<boolean> {
  return invoke<boolean>("memory_mark", { phase });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `check` until it gives something, or `null` after `timeoutMs`. */
async function until<T>(check: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value !== null) return value;
    await sleep(250);
  }
  return null;
}
