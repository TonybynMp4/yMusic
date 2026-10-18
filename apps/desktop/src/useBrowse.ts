import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AlbumPage, ArtistPage, PlaylistPage, Track } from "@ymusic/core";

import { engine } from "./engine.ts";

/** A browse page, by what opens it. The app's navigation stack holds these. */
export type Route =
  { kind: "album"; id: string } | { kind: "artist"; id: string } | { kind: "playlist"; id: string };

/**
 * Anything the main area can show besides search: a YouTube Music page, local
 * files (`id` is a folder path, or empty for all of them), the library page,
 * or the settings.
 */
export type View =
  | Route
  | { kind: "local"; id: string }
  | { kind: "library"; id: "" }
  | { kind: "settings"; id: "" };

export function viewKey(view: View): string {
  return `${view.kind}:${view.id}`;
}

export type Page =
  | { kind: "album"; page: AlbumPage }
  | { kind: "artist"; page: ArtistPage }
  | { kind: "playlist"; page: PlaylistPage };

export type BrowseState =
  | { status: "loading" }
  /**
   * `loadingMore`: a long playlist is still arriving, a page of rows at a
   * time. `resume`: the rest of it failed to load, and this fetches it again
   * from where it stopped.
   */
  | { status: "ready"; page: Page; loadingMore: boolean; resume?: () => void }
  | { status: "error"; error: string };

/**
 * Pages opened recently, so going back is instant and does not refetch, and a
 * long playlist keeps loading while you look at something else. A page that
 * changes upstream (a playlist gaining tracks) is fresh on next launch.
 *
 * Only the last `CACHE_LIMIT` are kept, oldest dropped first, since a page
 * holds everything parsed for it and an evening of browsing used to keep them
 * all (docs/memory.md). A page on screen, followed by the queue, or still
 * loading is never dropped. Going back to a dropped page fetches it again.
 */
interface Entry {
  state: BrowseState;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();
const CACHE_LIMIT = 10;

/**
 * Forgets every page nothing shows, and every failed one, so the next visit
 * fetches it again. A page on screen keeps its entry and its listeners.
 */
export function clearBrowseCache(): void {
  for (const [key, entry] of entries) {
    if (entry.listeners.size === 0 || entry.state.status === "error") entries.delete(key);
  }
}

type Loader = (
  route: Route,
  set: (state: BrowseState) => void,
  get: () => BrowseState,
) => Promise<void>;

function entryFor(route: Route, loader: Loader = load): Entry {
  const key = `${route.kind}:${route.id}`;
  let entry = entries.get(key);
  if (entry) {
    // Moved to the end, the most recently used, which is the last evicted.
    entries.delete(key);
    entries.set(key, entry);
  } else {
    const created: Entry = {
      state: { status: "loading" },
      listeners: new Set(),
    };
    const set = (state: BrowseState) => {
      created.state = state;
      for (const listener of created.listeners) listener();
    };
    entries.set(key, created);
    void loader(route, set, () => created.state).catch((error: unknown) =>
      set({ status: "error", error: message(error) }),
    );
    entry = created;
    evict();
  }
  return entry;
}

/** Drops the least recently used pages over the limit that nothing needs. */
function evict(): void {
  let over = entries.size - CACHE_LIMIT;
  for (const [key, entry] of entries) {
    if (over <= 0) return;
    const { state } = entry;
    const busy = state.status === "loading" || (state.status === "ready" && state.loadingMore);
    if (entry.listeners.size > 0 || busy) continue;
    entries.delete(key);
    over--;
  }
}

async function load(
  route: Route,
  set: (state: BrowseState) => void,
  get: () => BrowseState,
): Promise<void> {
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
    case "playlist":
      await follow(route.id, await firstPage(route.id), set, get);
  }
}

type FirstPage = Awaited<ReturnType<typeof engine.playlist>>;

/**
 * A playlist's first page, tried twice: a long playlist's first request is
 * the slow one, and one that times out often succeeds straight after.
 */
async function firstPage(id: string): Promise<FirstPage> {
  try {
    return await engine.playlist(id);
  } catch (error) {
    console.warn("could not open the playlist, trying again", error);
    await new Promise((resolve) => setTimeout(resolve, FIRST_PAGE_RETRY_MS));
    return engine.playlist(id);
  }
}

const FIRST_PAGE_RETRY_MS = 500;

/**
 * How often, at most, rows arriving for a long playlist are shown. Each
 * showing re-renders the page and updates a queue following it, so rows are
 * gathered between showings rather than shown a page of a hundred at a time.
 */
const PUBLISH_EVERY_MS = 250;

/**
 * Shows a playlist's first page, then the rest as it arrives, so a long
 * playlist is browsable at once and complete in the end. Each showing keeps
 * the page as it stands apart from its rows, so an edit made meanwhile (a
 * rename, say) is kept.
 *
 * When a later page fails, the rows so far stay and the state carries a
 * `resume` that fetches the rest from where it stopped. `held`, when
 * reloading a playlist whose rows are already showing, keeps those rows on
 * screen until as many have arrived again, even if the reload fails first.
 */
async function follow(
  id: string,
  first: FirstPage,
  set: (state: BrowseState) => void,
  get: () => BrowseState,
  held: Rows = { tracks: [], itemIds: [] },
): Promise<void> {
  const header = first.page;
  const tracks = [...header.tracks];
  const itemIds = [...header.itemIds];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = -Infinity;

  // The rows to show: the reload's own once it has caught up.
  const visible = (): Rows => (tracks.length < held.tracks.length ? held : { tracks, itemIds });

  const publish = (loadingMore: boolean, resume?: () => void) => {
    clearTimeout(timer);
    timer = undefined;
    last = Date.now();
    const current = get();
    const base =
      current.status === "ready" && current.page.kind === "playlist" ? current.page.page : header;
    const rows = visible();
    const page: Page = {
      kind: "playlist",
      page: { ...base, tracks: [...rows.tracks], itemIds: [...rows.itemIds] },
    };
    set(
      resume
        ? { status: "ready", page, loadingMore, resume }
        : { status: "ready", page, loadingMore },
    );
  };
  // Shows what has arrived now, or when the current interval is up.
  const progress = () => {
    if (tracks.length < held.tracks.length || timer !== undefined) return;
    const wait = last + PUBLISH_EVERY_MS - Date.now();
    if (wait <= 0) publish(true);
    else timer = setTimeout(() => publish(true), wait);
  };

  const reload = async () => {
    try {
      await follow(id, await engine.playlist(id), set, get, visible());
    } catch (error) {
      console.error("could not reload the playlist", error);
      publish(false, () => {
        publish(true);
        void reload();
      });
    }
  };

  // `resuming`: the first fetch is a retry of one that failed, whose handle
  // may have expired in the meantime, which only a reload gets past.
  const run = async (more: string | null, resuming: boolean): Promise<void> => {
    while (more !== null) {
      const handle: string = more;
      try {
        const next = await engine.playlistMore(handle);
        tracks.push(...next.tracks);
        itemIds.push(...next.itemIds);
        more = next.more;
      } catch (error) {
        if (resuming && expired(error)) return reload();
        console.error("could not load the rest of the playlist", error);
        publish(false, () => {
          publish(true);
          void run(handle, true);
        });
        return;
      }
      resuming = false;
      if (more !== null) progress();
    }
    // Complete: the playlist may have shrunk since the rows held were shown.
    held = { tracks: [], itemIds: [] };
    publish(false);
  };

  // A playlist of one page is shown once, by `run`, as complete.
  if (first.more !== null && tracks.length >= held.tracks.length) publish(true);
  else last = Date.now();
  await run(first.more, false);
}

/** A playlist's rows: its tracks, and each one's id within the playlist. */
interface Rows {
  tracks: readonly Track[];
  itemIds: readonly (string | null)[];
}

/** The engine's answer for a continuation it no longer holds (`playlistMore`). */
function expired(error: unknown): boolean {
  return message(error).includes("expired");
}

/** How many times a new playlist is fetched before its page shows whatever came back. */
const NEW_PLAYLIST_TRIES = 5;

/**
 * The route to a playlist just created with `tracks` songs, fetched afresh.
 * YouTube can take a few seconds to serve a new playlist, answering with an
 * empty page meanwhile, so the fetch is retried until the page has its title
 * and songs. Without this the empty page would be kept for the rest of the run.
 */
export function newPlaylistRoute(id: string, tracks: number): Route {
  const route: Route = { kind: "playlist", id };
  entries.delete(viewKey(route));
  entryFor(route, async (_, set, get) => {
    for (let attempt = 1; ; attempt++) {
      const first = await engine.playlist(id);
      // A first page with more to come is full, so the songs are all there.
      const served =
        first.page.title !== "" && (first.more !== null || first.page.tracks.length >= tracks);
      if (served || attempt === NEW_PLAYLIST_TRIES) return follow(id, first, set, get);
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  });
  return route;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A page's state now, outside React. */
export function browseState(route: Route): BrowseState {
  return entryFor(route).state;
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
  // Read through the cache rather than `entry`, so a page refreshed in place
  // shows the new copy. A page forgotten keeps its last copy, not refetched.
  return useSyncExternalStore(
    subscribe,
    () => (entries.get(`${route.kind}:${route.id}`) ?? entry).state,
  );
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

/**
 * Fetches a page afresh, for when an edit YouTube refused has left the copy
 * here out of step. Whatever shows the old copy moves to the new one.
 */
export function refreshPage(route: Route): void {
  const key = `${route.kind}:${route.id}`;
  const old = entries.get(key);
  entries.delete(key);
  entryFor(route);
  for (const listener of old?.listeners ?? []) listener();
}

/**
 * For a playlist changed from outside its page (songs saved to it from a
 * menu): a copy on screen is fetched again, and one kept for later is dropped
 * so the next visit fetches it. `id` may carry the `VL` browse prefix.
 */
export function playlistChanged(id: string): void {
  const bare = id.startsWith("VL") ? id.slice(2) : id;
  for (const route of [bare, `VL${bare}`].map((key): Route => ({ kind: "playlist", id: key }))) {
    const entry = entries.get(viewKey(route));
    if (!entry) continue;
    if (entry.listeners.size > 0) refreshPage(route);
    else entries.delete(viewKey(route));
  }
}

/** Drops a page that no longer exists, such as a playlist just deleted. */
export function forgetPage(route: Route): void {
  entries.delete(`${route.kind}:${route.id}`);
}
