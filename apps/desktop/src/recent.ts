import { useSyncExternalStore } from "react";

/**
 * When things last played on this device, for the library's "Recently played"
 * sort. Keyed like views (`playlist:…`, `album:…`, `artist:…`, `local:…`),
 * plus `track:…` for songs. YouTube keeps no such date for a saved album or
 * playlist that the app can read, so this is the app's own record.
 */
const KEY = "ymusic.recently-played";
/** Enough for a large library; the oldest go first. */
const LIMIT = 5000;

type Played = Readonly<Record<string, number>>;

let played: Played = read();
const listeners = new Set<() => void>();

function read(): Played {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Played) : {};
  } catch {
    return {};
  }
}

/** Marks `keys` as played now. */
export function recordPlayed(keys: readonly string[], at = Date.now()): void {
  if (keys.length === 0) return;
  const next: Record<string, number> = { ...played };
  for (const key of keys) next[key] = at;
  const entries = Object.entries(next);
  played =
    entries.length > LIMIT
      ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, LIMIT))
      : next;
  try {
    localStorage.setItem(KEY, JSON.stringify(played));
  } catch {
    // A full store costs the order, nothing else.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useRecentlyPlayed(): Played {
  return useSyncExternalStore(subscribe, () => played);
}
