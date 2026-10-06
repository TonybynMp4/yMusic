import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AlbumPage, ArtistPage, PlaylistPage, Track } from "@ymusic/core";

import { engine } from "./engine.ts";

/** A browse page, by what opens it. The app's navigation stack holds these. */
export type Route =
  { kind: "album"; id: string } | { kind: "artist"; id: string } | { kind: "playlist"; id: string };

/**
 * Anything the main area can show besides search: a YouTube Music page, local
 * files (`id` is a folder path, or empty for all of them), or the settings.
 */
export type View = Route | { kind: "local"; id: string } | { kind: "settings"; id: "" };

export function viewKey(view: View): string {
  return `${view.kind}:${view.id}`;
}

export type Page =
  | { kind: "album"; page: AlbumPage }
  | { kind: "artist"; page: ArtistPage }
  | { kind: "playlist"; page: PlaylistPage };

export type BrowseState =
  | { status: "loading" }
  /** `loadingMore`: a long playlist is still arriving, a page of rows at a time. */
  | { status: "ready"; page: Page; loadingMore: boolean }
  | { status: "error"; error: string };

/**
 * Pages already opened this run, so going back is instant and does not
 * refetch, and a long playlist keeps loading while you look at something
 * else. A page that changes upstream (a playlist gaining tracks) is fresh on
 * next launch.
 */
interface Entry {
  state: BrowseState;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();

function entryFor(route: Route): Entry {
  const key = `${route.kind}:${route.id}`;
  let entry = entries.get(key);
  if (!entry) {
    const created: Entry = {
      state: { status: "loading" },
      listeners: new Set(),
    };
    const set = (state: BrowseState) => {
      created.state = state;
      for (const listener of created.listeners) listener();
    };
    entries.set(key, created);
    void load(route, set).catch((error: unknown) =>
      set({ status: "error", error: message(error) }),
    );
    entry = created;
  }
  return entry;
}

async function load(route: Route, set: (state: BrowseState) => void): Promise<void> {
  switch (route.kind) {
    case "album":
      set({
        status: "ready",
        page: { kind: "album", page: await engine.album(route.id) },
        loadingMore: false,
      });
      return;
    case "artist":
      set({
        status: "ready",
        page: { kind: "artist", page: await engine.artist(route.id) },
        loadingMore: false,
      });
      return;
    case "playlist": {
      const first = await engine.playlist(route.id);
      let page = first.page;
      set({
        status: "ready",
        page: { kind: "playlist", page },
        loadingMore: first.more !== null,
      });
      for (let more = first.more; more !== null;) {
        try {
          const next = await engine.playlistMore(more);
          page = { ...page, tracks: [...page.tracks, ...next.tracks] };
          more = next.more;
        } catch (error) {
          // What arrived stays; the rest is simply missing until next launch.
          console.error("could not load the rest of the playlist", error);
          more = null;
        }
        set({
          status: "ready",
          page: { kind: "playlist", page },
          loadingMore: more !== null,
        });
      }
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useBrowse(route: Route): BrowseState {
  const entry = entryFor(route);
  // A failure is forgotten once its page is left, so opening it again retries:
  // offline for a moment should not stick for the rest of the run.
  useEffect(
    () => () => {
      if (entry.state.status === "error") entries.delete(`${route.kind}:${route.id}`);
    },
    [entry, route.kind, route.id],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      entry.listeners.add(listener);
      return () => void entry.listeners.delete(listener);
    },
    [entry],
  );
  return useSyncExternalStore(subscribe, () => entry.state);
}

/**
 * Follows a playlist as it loads: `listener` gets every track so far, now and
 * on each page that arrives, and whether more are still coming. For the queue,
 * so playing a long playlist queues all of it and not just the first page.
 */
export function followPlaylist(
  id: string,
  listener: (tracks: readonly Track[], loading: boolean) => void,
): () => void {
  const entry = entryFor({ kind: "playlist", id });
  const notify = () => {
    const { state } = entry;
    if (state.status === "loading") return;
    if (state.status === "ready" && state.page.kind === "playlist") {
      listener(state.page.page.tracks, state.loadingMore);
    } else {
      listener([], false);
    }
  };
  entry.listeners.add(notify);
  notify();
  return () => void entry.listeners.delete(notify);
}

/**
 * A page once it has fully arrived, every row of a long playlist included:
 * for acting on one without opening it, as its menu does.
 */
export function settledPage(route: Route): Promise<Page> {
  const entry = entryFor(route);
  return new Promise((resolve, reject) => {
    const check = () => {
      const { state } = entry;
      if (state.status === "loading" || (state.status === "ready" && state.loadingMore)) return;
      entry.listeners.delete(check);
      if (state.status === "ready") return resolve(state.page);
      // Forgotten, so the next try fetches again.
      entries.delete(`${route.kind}:${route.id}`);
      reject(new Error(state.error));
    };
    entry.listeners.add(check);
    check();
  });
}

/**
 * Changes a page already loaded, after an action whose outcome is known
 * (saving it to the library, say), so it shows without a refetch.
 */
export function patchPage(route: Route, patch: (page: Page) => Page): void {
  const entry = entries.get(`${route.kind}:${route.id}`);
  if (entry?.state.status !== "ready") return;
  entry.state = { ...entry.state, page: patch(entry.state.page) };
  for (const listener of entry.listeners) listener();
}
