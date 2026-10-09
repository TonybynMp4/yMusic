import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { BrowseCard, Track } from "@ymusic/core";

import { engine } from "./engine.ts";

/**
 * The saved albums, artists and songs in the account's library, for the
 * library page's chips. Each list loads when its chip is first opened, and is
 * kept for the run, per account, so switching chips is instant.
 */
export type SavedState<T> =
  | { status: "loading" }
  /** `loadingMore`: a long list of songs is still arriving, a page at a time. */
  | { status: "ready"; items: T[]; loadingMore: boolean }
  | { status: "error"; error: string };

export type SavedKind = "albums" | "artists" | "songs";

interface Entry {
  state: SavedState<BrowseCard | Track>;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();

function entryFor(account: string, kind: SavedKind): Entry {
  const key = `${account}\n${kind}`;
  let entry = entries.get(key);
  if (!entry) {
    const created: Entry = { state: { status: "loading" }, listeners: new Set() };
    const set = (state: Entry["state"]) => {
      created.state = state;
      for (const listener of created.listeners) listener();
    };
    entries.set(key, created);
    void load(kind, set).catch((error: unknown) =>
      set({ status: "error", error: error instanceof Error ? error.message : String(error) }),
    );
    entry = created;
  }
  return entry;
}

async function load(kind: SavedKind, set: (state: Entry["state"]) => void): Promise<void> {
  if (kind === "albums") {
    set({ status: "ready", items: await engine.libraryAlbums(), loadingMore: false });
    return;
  }
  if (kind === "artists") {
    set({ status: "ready", items: await engine.libraryArtists(), loadingMore: false });
    return;
  }
  // Songs arrive like a long playlist: the first page shows at once.
  const first = await engine.librarySongs();
  let tracks = first.tracks;
  set({ status: "ready", items: tracks, loadingMore: first.more !== null });
  for (let more = first.more; more !== null;) {
    try {
      const next = await engine.playlistMore(more);
      tracks = [...tracks, ...next.tracks];
      more = next.more;
    } catch (error) {
      console.error("could not load the rest of the library's songs", error);
      more = null;
    }
    set({ status: "ready", items: tracks, loadingMore: more !== null });
  }
}

/** Drops every list, so the next look fetches them again: after a save, a removal, or Refresh. */
export function forgetSaved(): void {
  // A list still loading finishes into an entry nobody reads.
  entries.clear();
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

const idle: SavedState<never> = { status: "ready", items: [], loadingMore: false };

/** `account` null (signed out) or `kind` null (another chip) loads nothing. */
export function useSaved(
  account: string | null,
  kind: "albums" | "artists" | null,
): SavedState<BrowseCard>;
export function useSaved(account: string | null, kind: "songs" | null): SavedState<Track>;
export function useSaved(
  account: string | null,
  kind: SavedKind | null,
): SavedState<BrowseCard | Track> {
  // Read for the re-render: after `forgetSaved`, `entryFor` makes a new entry.
  useSyncExternalStore(subscribeForgotten, () => generation);
  const entry = account === null || kind === null ? null : entryFor(account, kind);
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
      const key = `${account}\n${kind}`;
      if (entries.get(key)?.state.status === "error") entries.delete(key);
    },
    [account, kind],
  );
  return state;
}
