import { useMemo } from "react";
import {
  hashKey,
  QueryObserver,
  queryOptions,
  useQuery,
  type Query,
  type QueryKey,
  type QueryObserverResult,
  type QueryState,
} from "@tanstack/react-query";
import type { AlbumPage, ArtistPage, PlaylistPage, Track } from "@ymusic/core";

import { engine } from "./engine.ts";
import { capQueries, queryClient } from "./query.ts";

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
 * What a browse query holds: the page, and for a playlist that stopped short
 * of its end, the engine's handle for the rows after those in `page`. Null
 * once every row is in, and while it is still loading, the handle for the
 * next page. A handle only lasts the run, so one from a persisted copy fails
 * as expired and the playlist reloads.
 */
interface Loaded {
  page: Page;
  more: string | null;
}

function keyOf(route: Route) {
  return ["browse", route.kind, route.id] as const;
}

/**
 * Pages opened recently, so going back is instant and does not refetch, and a
 * long playlist keeps loading while you look at something else. A page stays
 * fresh for the run (see `query.ts`).
 *
 * Only the last `CACHE_LIMIT` are kept, least recently used dropped first,
 * since a page holds everything parsed for it and an evening of browsing used
 * to keep them all (docs/memory.md). A page on screen, followed by the queue,
 * or still loading is never dropped. Going back to a dropped page fetches it
 * again. A page that failed to open is fetched again when it is next shown.
 */
const CACHE_LIMIT = 10;

/** Query hashes, least recently used first. */
const used = new Map<string, true>();

function touch(route: Route): void {
  const hash = hashKey(keyOf(route));
  used.delete(hash);
  used.set(hash, true);
}

capQueries(["browse"], CACHE_LIMIT, (queries) => {
  const rank = new Map([...used.keys()].map((hash, i) => [hash, i]));
  const at = (query: Query) => rank.get(query.queryHash) ?? Infinity;
  return [...queries].sort((a, b) => at(a) - at(b));
});
queryClient.getQueryCache().subscribe((event) => {
  if (event.type === "removed") used.delete(event.query.queryHash);
});

function browseOptions(route: Route) {
  return queryOptions({
    queryKey: keyOf(route),
    queryFn: () => load(route),
    // Dropped by `capQueries`, not by time.
    gcTime: Infinity,
    // A playlist's first page is tried twice: a long playlist's first request
    // is the slow one, and one that times out often succeeds straight after.
    // Later pages never fail the query (see `stream`).
    retry: route.kind === "playlist" ? 1 : 0,
    retryDelay: FIRST_PAGE_RETRY_MS,
  });
}

const FIRST_PAGE_RETRY_MS = 500;

/**
 * Forgets every page nothing shows or follows, so the next visit fetches it
 * again.
 */
export function clearBrowseCache(): void {
  queryClient.removeQueries({
    queryKey: ["browse"],
    predicate: (query) => query.getObserversCount() === 0,
  });
}

async function load(route: Route): Promise<Loaded> {
  switch (route.kind) {
    case "album":
      return { page: { kind: "album", page: await engine.album(route.id) }, more: null };
    case "artist":
      return { page: { kind: "artist", page: await engine.artist(route.id) }, more: null };
    case "playlist":
      return loadPlaylist(route.id);
  }
}

type FirstPage = Awaited<ReturnType<typeof engine.playlist>>;

/** A playlist's rows: its tracks, and each one's id within the playlist. */
interface Rows {
  tracks: readonly Track[];
  itemIds: readonly (string | null)[];
}

/**
 * Rows already on screen while a playlist reloads, kept there until as many
 * have arrived again. `more` is the handle for the rows after them, if any, so
 * a reload that fails before catching up leaves them as they were.
 */
interface Held {
  rows: Rows;
  more: string | null;
}

/**
 * A playlist, from wherever its copy here stands. With no copy, from the
 * first page. With a copy that stopped short, a Retry: from the page that
 * failed. With a whole copy, invalidated or from an earlier run, a reload
 * that keeps the rows showing until it catches up.
 */
async function loadPlaylist(id: string): Promise<Loaded> {
  const key = keyOf({ kind: "playlist", id });
  const live = claim(key);
  const before = queryClient.getQueryData<Loaded>(key);
  if (before?.page.kind !== "playlist") return stream(id, live, await firstPage(id), null);
  if (before.more !== null) return resume(id, live, before.page.page, before.more);
  return stream(id, live, await engine.playlist(id), { rows: before.page.page, more: null });
}

/** The fetch each query is running, so one superseded or dropped stops writing. */
const runs = new WeakMap<Query, object>();

/**
 * Marks the fetch starting now as the one that owns the page. The answer is
 * false once a newer fetch (Refresh) has started, or the page was forgotten.
 */
function claim(key: QueryKey): () => boolean {
  const cache = queryClient.getQueryCache();
  const query = cache.get(hashKey(key));
  const run = {};
  if (query) runs.set(query, run);
  return () => query !== undefined && cache.get(query.queryHash) === query && runs.get(query) === run;
}

/**
 * Continues `shown` from `more`, the page that failed, reloading if its
 * handle has expired. Failing again leaves it as it was.
 */
async function resume(
  id: string,
  live: () => boolean,
  shown: PlaylistPage,
  more: string,
): Promise<Loaded> {
  const stopped: Loaded = { page: { kind: "playlist", page: shown }, more };
  try {
    const next = await engine.playlistMore(more);
    return stream(id, live, {
      page: {
        ...shown,
        tracks: [...shown.tracks, ...next.tracks],
        itemIds: [...shown.itemIds, ...next.itemIds],
      },
      more: next.more,
    }, null);
  } catch (error) {
    if (!expired(error)) {
      console.error("could not load the rest of the playlist", error);
      return stopped;
    }
  }
  try {
    return await stream(id, live, await engine.playlist(id), { rows: shown, more });
  } catch (error) {
    console.error("could not reload the playlist", error);
    return stopped;
  }
}

/** Playlists just created, with how many songs each should have. */
const created = new Map<string, number>();

/** How many times a new playlist is fetched before its page shows whatever came back. */
const NEW_PLAYLIST_TRIES = 5;

/**
 * A playlist's first page. YouTube can take a few seconds to serve a playlist
 * just created, answering with an empty page meanwhile, so one of those is
 * fetched until the page has its title and songs.
 */
async function firstPage(id: string): Promise<FirstPage> {
  const tracks = created.get(id);
  if (tracks === undefined) return engine.playlist(id);
  for (let attempt = 1; ; attempt++) {
    const first = await engine.playlist(id);
    // A first page with more to come is full, so the songs are all there.
    const served = first.page.title !== "" && (first.more !== null || first.page.tracks.length >= tracks);
    if (served || attempt === NEW_PLAYLIST_TRIES) {
      created.delete(id);
      return first;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
}

/**
 * How often, at most, rows arriving for a long playlist are shown. Each
 * showing re-renders the page and updates a queue following it, so rows are
 * gathered between showings rather than shown a page of a hundred at a time.
 */
const PUBLISH_EVERY_MS = 250;

/**
 * Shows a playlist's first page, then the rest as it arrives, so a long
 * playlist is browsable at once and complete in the end. The rows arrive
 * through `setQueryData` while the query is still fetching, and the query
 * settles once every row is in, or with the handle of a page that failed.
 * Each showing keeps the page as it stands apart from its rows, so an edit
 * made meanwhile (a rename, say) is kept. `live` turns false when a newer
 * fetch takes over, which stops this one.
 */
async function stream(
  id: string,
  live: () => boolean,
  first: FirstPage,
  held: Held | null,
): Promise<Loaded> {
  const key = keyOf({ kind: "playlist", id });

  const header = first.page;
  const tracks = [...header.tracks];
  const itemIds = [...header.itemIds];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = -Infinity;

  const caughtUp = () => held === null || tracks.length >= held.rows.tracks.length;
  const loaded = (rows: Rows, more: string | null): Loaded => {
    const current = queryClient.getQueryData<Loaded>(key);
    const base = current?.page.kind === "playlist" ? current.page.page : header;
    return {
      page: { kind: "playlist", page: { ...base, tracks: [...rows.tracks], itemIds: [...rows.itemIds] } },
      more,
    };
  };
  const publish = (more: string | null) => {
    clearTimeout(timer);
    timer = undefined;
    last = Date.now();
    if (live()) queryClient.setQueryData(key, loaded({ tracks, itemIds }, more));
  };
  // Shows what has arrived now, or when the current interval is up.
  const progress = (more: string) => {
    if (!caughtUp() || timer !== undefined) return;
    const wait = last + PUBLISH_EVERY_MS - Date.now();
    if (wait <= 0) publish(more);
    else timer = setTimeout(() => publish(more), wait);
  };

  // A playlist of one page is shown once, as the query's result.
  if (first.more !== null && caughtUp()) publish(first.more);
  else last = Date.now();

  for (let more = first.more; more !== null; ) {
    if (!live()) break;
    const handle: string = more;
    try {
      const next = await engine.playlistMore(handle);
      tracks.push(...next.tracks);
      itemIds.push(...next.itemIds);
      more = next.more;
    } catch (error) {
      console.error("could not load the rest of the playlist", error);
      clearTimeout(timer);
      // Behind the rows held, those stay, with the handle that continues them.
      if (held !== null && !caughtUp() && held.more !== null) return loaded(held.rows, held.more);
      return loaded({ tracks, itemIds }, handle);
    }
    if (more !== null) progress(more);
  }
  clearTimeout(timer);
  // Complete: the playlist may have shrunk since the rows held were shown.
  return loaded({ tracks, itemIds }, null);
}

/** The engine's answer for a continuation it no longer holds (`playlistMore`). */
function expired(error: unknown): boolean {
  return message(error).includes("expired");
}

/**
 * The route to a playlist just created with `tracks` songs, fetched afresh.
 * Without the wait in `firstPage`, the empty page YouTube serves at first
 * would be kept for the rest of the run.
 */
export function newPlaylistRoute(id: string, tracks: number): Route {
  const route: Route = { kind: "playlist", id };
  queryClient.removeQueries({ queryKey: keyOf(route), exact: true });
  created.set(id, tracks);
  touch(route);
  void queryClient.prefetchQuery(browseOptions(route));
  return route;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The parts of a query's state a page's state comes from. */
type Snapshot = Pick<QueryState<Loaded | undefined>, "data" | "status" | "fetchStatus" | "error">;

function stateOf(route: Route, state: Snapshot): BrowseState {
  const { data } = state;
  if (data === undefined) {
    return state.status === "error" && state.fetchStatus === "idle"
      ? { status: "error", error: message(state.error) }
      : { status: "loading" };
  }
  const fetching = state.fetchStatus !== "idle";
  if (!fetching && data.more !== null) {
    return { status: "ready", page: data.page, loadingMore: false, resume: () => retry(route) };
  }
  return { status: "ready", page: data.page, loadingMore: route.kind === "playlist" && fetching };
}

/** Fetches a playlist that stopped short again, from where it stopped. */
function retry(route: Route): void {
  queryClient.fetchQuery({ ...browseOptions(route), staleTime: 0 }).catch(() => {});
}

/** A page's state now, outside React, starting its load if nothing has. */
export function browseState(route: Route): BrowseState {
  touch(route);
  const key = keyOf(route);
  if (queryClient.getQueryState(key) === undefined) {
    void queryClient.prefetchQuery(browseOptions(route));
  }
  return stateOf(route, queryClient.getQueryState<Loaded>(key) ?? pending);
}

const pending: Snapshot = { data: undefined, status: "pending", fetchStatus: "fetching", error: null };

export function useBrowse(route: Route): BrowseState {
  touch(route);
  const { data, status, fetchStatus, error } = useQuery(browseOptions(route));
  const { kind, id } = route;
  return useMemo(
    () => stateOf({ kind, id } as Route, { data, status, fetchStatus, error }),
    [kind, id, data, status, fetchStatus, error],
  );
}

/** Watches a page from outside React, fetching it if it needs to be. */
function observe(route: Route, listener: (result: QueryObserverResult<Loaded>) => void): () => void {
  touch(route);
  const observer = new QueryObserver(queryClient, browseOptions(route));
  const stop = observer.subscribe(listener);
  listener(observer.getCurrentResult());
  return stop;
}

/**
 * Follows a playlist as it loads: `listener` gets every track so far, now and
 * on each page that arrives, and whether more are still coming. For the queue,
 * so playing a long playlist queues all of it and not just the first page.
 * While it follows, the playlist is not dropped from the cache.
 */
export function followPlaylist(
  id: string,
  listener: (tracks: readonly Track[], loading: boolean) => void,
): () => void {
  let told: { tracks: readonly Track[]; loading: boolean } | null = null;
  return observe({ kind: "playlist", id }, ({ data, status, fetchStatus }) => {
    const loading = fetchStatus !== "idle";
    let tracks: readonly Track[];
    if (data?.page.kind === "playlist") tracks = data.page.page.tracks;
    else if (data === undefined && status === "error" && !loading) tracks = [];
    else return;
    if (told?.tracks === tracks && told.loading === loading) return;
    told = { tracks, loading };
    listener(tracks, loading);
  });
}

/**
 * A page once it has fully arrived, every row of a long playlist included:
 * for acting on one without opening it, as its menu does.
 */
export function settledPage(route: Route): Promise<Page> {
  return new Promise((resolve, reject) => {
    let stop: (() => void) | null = null;
    let done = false;
    stop = observe(route, ({ data, status, fetchStatus, error }) => {
      if (done || status === "pending" || fetchStatus !== "idle") return;
      done = true;
      // Deferred: the first answer can come before `observe` returns.
      queueMicrotask(() => stop?.());
      if (data !== undefined) resolve(data.page);
      else reject(error instanceof Error ? error : new Error(message(error)));
    });
    if (done) stop();
  });
}

/**
 * Changes a page already loaded, after an action whose outcome is known
 * (saving it to the library, say), so it shows without a refetch.
 */
export function patchPage(route: Route, patch: (page: Page) => Page): void {
  queryClient.setQueryData<Loaded>(keyOf(route), (loaded) =>
    loaded && { ...loaded, page: patch(loaded.page) },
  );
}

/**
 * Fetches a page afresh, for when an edit YouTube refused has left the copy
 * here out of step. The copy shows until the new one is in.
 */
export function refreshPage(route: Route): void {
  const key = keyOf(route);
  // A playlist that stopped short reloads rather than resuming.
  queryClient.setQueryData<Loaded>(key, (loaded) => loaded && { ...loaded, more: null });
  void queryClient.invalidateQueries({ queryKey: key, exact: true });
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
  queryClient.removeQueries({ queryKey: keyOf(route), exact: true });
}
