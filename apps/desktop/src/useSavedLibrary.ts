import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { BrowseCard, Track } from "@ymusic/core";

import { engine } from "./engine.ts";

/**
 * The playlists, saved albums, artists and songs in the account's library,
 * for the library page's chips. Each list loads when its chip is first opened,
 * and is kept for the run, per account and sort, so switching chips is
 * instant.
 */
export type SavedState<T> =
  | { status: "loading" }
  /**
   * `loadingMore`: a long list of songs is still arriving, a page at a time.
   * `sorts`: the orders YouTube offers for the list; `sort`, the one applied.
   */
  | { status: "ready"; items: T[]; loadingMore: boolean; sorts: string[]; sort: string | null }
  | { status: "error"; error: string };

export type SavedKind = "playlists" | "albums" | "artists" | "songs";

type Ready = Extract<SavedState<BrowseCard | Track>, { status: "ready" }>;

interface Entry {
  state: SavedState<BrowseCard | Track>;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();
/** What a dropped list held, shown again while its reload runs. */
const previous = new Map<string, Ready>();

/** `sort` empty for YouTube's default order. */
function keyOf(account: string, kind: SavedKind, sort: string): string {
  return `${account}\n${kind}\n${sort}`;
}

function entryFor(account: string, kind: SavedKind, sort: string): Entry {
  const key = keyOf(account, kind, sort);
  let entry = entries.get(key);
  if (!entry) {
    const seed = previous.get(key);
    previous.delete(key);
    const created: Entry = {
      state: seed ? { ...seed, loadingMore: false } : { status: "loading" },
      listeners: new Set(),
    };
    const set = (state: Entry["state"]) => {
      created.state = state;
      for (const listener of created.listeners) listener();
    };
    entries.set(key, created);
    void load(kind, sort, set, () => entries.get(key) !== created, seed !== undefined).catch(
      (error: unknown) => {
        // A failed reload keeps the list it was refreshing.
        if (seed) console.error("could not reload the library", error);
        else {
          set({ status: "error", error: error instanceof Error ? error.message : String(error) });
        }
      },
    );
    entry = created;
  }
  return entry;
}

/**
 * `dropped` turns true once `forgetSaved` lets go of the entry, which stops the
 * paging. A `quiet` reload keeps the old list until every page is in, rather
 * than shrinking it to the first page.
 */
async function load(
  kind: SavedKind,
  sort: string,
  set: (state: Entry["state"]) => void,
  dropped: () => boolean,
  quiet: boolean,
): Promise<void> {
  if (kind !== "songs") {
    const list = await engine.libraryCards(kind, sort || undefined);
    set({
      status: "ready",
      items: list.cards,
      loadingMore: false,
      sorts: list.sorts,
      sort: list.sort,
    });
    return;
  }
  // Songs arrive like a long playlist: the first page shows at once.
  const first = await engine.librarySongs(sort || undefined);
  const { sorts } = first;
  let tracks = first.tracks;
  const ready = (loadingMore: boolean): Ready => ({
    status: "ready",
    items: tracks,
    loadingMore,
    sorts,
    sort: first.sort,
  });
  if (!quiet) set(ready(first.more !== null));
  for (let more = first.more; more !== null && !dropped(); ) {
    try {
      const next = await engine.playlistMore(more);
      tracks = [...tracks, ...next.tracks];
      more = next.more;
    } catch (error) {
      console.error("could not load the rest of the library's songs", error);
      // A quiet reload keeps the old list rather than a shorter one.
      if (quiet) return;
      more = null;
    }
    if (!quiet) set(ready(more !== null));
  }
  if (quiet && !dropped()) set(ready(false));
}

/**
 * Drops the lists of `kind`, or every list, so the next look fetches them
 * again: after a save, a removal, a like, or Refresh. A list on screen stays
 * there until its reload comes back.
 */
export function forgetSaved(kind?: SavedKind): void {
  for (const [key, entry] of entries) {
    if (kind !== undefined && key.split("\n")[1] !== kind) continue;
    entries.delete(key);
    if (entry.state.status === "ready") previous.set(key, entry.state);
  }
  generation += 1;
  for (const listener of forgotten) listener();
}

/** Bumped by `forgetSaved`, so a page showing a list subscribes to its new entry. */
let generation = 0;
const forgotten = new Set<() => void>();

function subscribeForgotten(listener: () => void): () => void {
  forgotten.add(listener);
  return () => void forgotten.delete(listener);
}

const idle: SavedState<never> = {
  status: "ready",
  items: [],
  loadingMore: false,
  sorts: [],
  sort: null,
};

/**
 * `account` null (signed out) or `kind` null (another chip) loads nothing.
 * `sort` is one of the list's `sorts`, or empty for YouTube's default.
 */
export function useSaved(
  account: string | null,
  kind: "playlists" | "albums" | "artists" | null,
  sort: string,
): SavedState<BrowseCard>;
export function useSaved(
  account: string | null,
  kind: "songs" | null,
  sort: string,
): SavedState<Track>;
export function useSaved(
  account: string | null,
  kind: SavedKind | null,
  sort: string,
): SavedState<BrowseCard | Track> {
  // Read for the re-render: after `forgetSaved`, `entryFor` makes a new entry.
  useSyncExternalStore(subscribeForgotten, () => generation);
  const entry = account === null || kind === null ? null : entryFor(account, kind, sort);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (entry === null) return () => {};
      entry.listeners.add(listener);
      return () => void entry.listeners.delete(listener);
    },
    [entry],
  );
  const state = useSyncExternalStore(subscribe, () => entry?.state ?? idle);
  // A failure is forgotten once its chip is left, so opening it again retries.
  useEffect(
    () => () => {
      if (account === null || kind === null) return;
      const key = keyOf(account, kind, sort);
      if (entries.get(key)?.state.status === "error") entries.delete(key);
    },
    [account, kind, sort],
  );
  return state;
}
