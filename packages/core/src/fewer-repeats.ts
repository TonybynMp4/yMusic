import type { Track } from "./domain.ts";

/**
 * "Fewer repeats": shuffle still picks a random order, but songs played
 * recently tend to land later in it. The queue reducer takes the weighting
 * on its actions, so it stays pure; this file holds the weighting and the
 * play history it is read from.
 */

/** How strongly a track should come early. Higher comes earlier. */
export type TrackWeight = (track: Track) => number;

/** When each track last played, in ms since the epoch, keyed by track id. */
export type PlayHistory = Readonly<Record<string, number>>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** How fast a play is forgotten: a week after it, a track is most of the way back. */
const RECOVERY_MS = 7 * DAY_MS;
/** The weight of a track that played a moment ago. Never 0, so it can still come early. */
const JUST_PLAYED = 0.05;
/** Older plays weigh within a hair of never played, so they are not kept. */
export const PLAY_HISTORY_MAX_AGE_MS = 60 * DAY_MS;
/** A bound on the file whatever the listening. */
export const PLAY_HISTORY_MAX_ENTRIES = 5000;

/**
 * 1 for a track never played, rising from 0.05 just after a play: about 0.65
 * a week later and 0.99 after a month.
 */
export function recencyWeight(lastPlayedMs: number | undefined, nowMs: number): number {
  if (lastPlayedMs === undefined) return 1;
  const age = Math.max(0, nowMs - lastPlayedMs);
  return 1 - (1 - JUST_PLAYED) * Math.exp(-age / RECOVERY_MS);
}

/** A weighting for the queue from the play history, as of `nowMs`. */
export function playHistoryWeight(history: PlayHistory, nowMs: number): TrackWeight {
  return (track) => recencyWeight(history[track.id], nowMs);
}

/** `history` with `trackId` played at `nowMs`, and old or excess entries dropped. */
export function recordPlay(history: PlayHistory, trackId: string, nowMs: number): PlayHistory {
  const entries = Object.entries({ ...history, [trackId]: nowMs })
    .filter(([, at]) => nowMs - at < PLAY_HISTORY_MAX_AGE_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, PLAY_HISTORY_MAX_ENTRIES);
  return Object.fromEntries(entries);
}

/**
 * A weighted random sort key (Efraimidis and Spirakis): an exponential draw
 * with rate `weight`. Sorting ascending puts heavier items earlier on average
 * while any order stays possible.
 */
function sortKey(weight: number, rng: () => number): number {
  // rng is in [0, 1), so 1 - rng() is never 0 and the log is finite.
  return -Math.log(1 - rng()) / Math.max(weight, 1e-6);
}

/** `indices` in a weighted random order. */
export function weightedOrder(
  indices: readonly number[],
  weightOf: (index: number) => number,
  rng: () => number,
): number[] {
  return indices
    .map((index) => ({ index, key: sortKey(weightOf(index), rng) }))
    .sort((a, b) => a.key - b.key)
    .map(({ index }) => index);
}

/**
 * Places `added` among `order` from position `start` on, leaving everything
 * already there in its order. The upcoming tracks have no keys of their own,
 * so a fresh set is drawn for them and handed out in sorted order to the
 * positions they hold; each new track then goes where its key falls. With
 * equal weights this is a uniform random slot, as without fewer repeats.
 */
export function weightedInsert(
  order: readonly number[],
  start: number,
  added: readonly number[],
  weightOf: (index: number) => number,
  rng: () => number,
): number[] {
  const head = order.slice(0, start);
  const upcoming = order.slice(start);
  const keys = upcoming.map((index) => sortKey(weightOf(index), rng)).sort((a, b) => a - b);
  for (const index of added) {
    const key = sortKey(weightOf(index), rng);
    let at = 0;
    while (at < keys.length && keys[at]! <= key) at++;
    keys.splice(at, 0, key);
    upcoming.splice(at, 0, index);
  }
  return [...head, ...upcoming];
}
