import { useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { BrowseCard, Track } from "@ymusic/core";

import { engine } from "./engine.ts";
import { errorMessage } from "./errors.ts";
import { queryClient } from "./query.ts";

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

/**
 * What a list's query holds: the ready state, with `partial` set while the
 * first load of a long list of songs is still arriving.
 */
type Loaded = Omit<Ready, "loadingMore"> & { partial?: true };

/** `sort` empty for YouTube's default order. */
function savedKey(account: string, kind: SavedKind, sort: string) {
  return ["saved", account, kind, sort] as const;
}

/**
 * Bumped by `forgetSaved` for each kind, which stops a list of that kind
 * still paging: the reload that follows owns the list from then on.
 */
const generations = new Map<SavedKind, number>();

function savedOptions(account: string, kind: SavedKind, sort: string) {
  return queryOptions({
    queryKey: savedKey(account, kind, sort),
    queryFn: () => load(account, kind, sort),
    // Kept for the run, per account and sort, like the browse pages.
    gcTime: Infinity,
  });
}

/**
 * A list, whole. Songs arrive like a long playlist: on a first load, the first
 * page shows at once and the rest as it comes. A reload keeps the list
 * showing until every page is in, rather than shrinking it to the first page.
 */
async function load(account: string, kind: SavedKind, sort: string): Promise<Loaded> {
  if (kind !== "songs") {
    const list = await engine.libraryCards(kind, sort || undefined);
    return { status: "ready", items: list.cards, sorts: list.sorts, sort: list.sort };
  }
  const key = savedKey(account, kind, sort);
  const generation = generations.get(kind) ?? 0;
  const dropped = () => (generations.get(kind) ?? 0) !== generation;
  // A list already whole stays up until its reload is; a partial one keeps
  // loading in view.
  const before = queryClient.getQueryData<Loaded>(key);
  const reload = before !== undefined && before.partial !== true;
  const first = await engine.librarySongs(sort || undefined);
  const { sorts } = first;
  let tracks = first.tracks;
  const loaded = (): Loaded => ({ status: "ready", items: tracks, sorts, sort: first.sort });
  const show = () =>
    !reload && !dropped() && queryClient.setQueryData<Loaded>(key, { ...loaded(), partial: true });
  if (first.more !== null) show();
  for (let more = first.more; more !== null && !dropped();) {
    try {
      const next = await engine.playlistMore(more);
      tracks = [...tracks, ...next.tracks];
      more = next.more;
    } catch (error) {
      console.error("could not load the rest of the library's songs", error);
      // A reload keeps the old list rather than a shorter one.
      if (reload) throw error;
      more = null;
    }
    if (more !== null) show();
  }
  return loaded();
}

/**
 * Marks the lists of `kind`, or every list, out of date: after a save, a
 * removal, a like, or Refresh. A list on screen is fetched again at once and
 * stays there until its reload comes back; the others are fetched again the
 * next time they show.
 */
export function forgetSaved(kind?: SavedKind): void {
  for (const k of ["playlists", "albums", "artists", "songs"] as const) {
    if (kind === undefined || kind === k) generations.set(k, (generations.get(k) ?? 0) + 1);
  }
  void queryClient.invalidateQueries({
    queryKey: ["saved"],
    predicate: ({ queryKey }) => kind === undefined || queryKey[2] === kind,
  });
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
  const enabled = account !== null && kind !== null;
  const { data, status, error, isFetching } = useQuery({
    ...savedOptions(account ?? "", kind ?? "playlists", sort),
    enabled,
  });
  return useMemo((): SavedState<BrowseCard | Track> => {
    if (!enabled) return idle;
    if (data !== undefined) {
      const { partial, ...ready } = data;
      return { ...ready, loadingMore: isFetching && partial === true };
    }
    if (status === "error" && !isFetching) {
      return { status: "error", error: errorMessage(error) };
    }
    return { status: "loading" };
  }, [enabled, data, status, error, isFetching]);
}
