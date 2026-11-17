import { useEffect } from "react";

import { inUse, queryClient } from "./query.ts";
import { clearBrowseCache, type View } from "./useBrowse.ts";
import { useWindowHidden } from "./useWindowHidden.ts";

/**
 * What the pages fetch and only a visible window reads: library lists, search
 * results and the playlists a song can be added to. Browse pages go through
 * `clearBrowseCache`. Stream leases (`stream`) are not here, because the player
 * reads them, and neither are song years, which are small and which the
 * player bar would fetch again as soon as it is drawn.
 */
const PAGE_DATA = ["saved", "search", "playlist-targets"] as const;
const DROPPED: readonly unknown[] = ["browse", ...PAGE_DATA];

/**
 * Drops the fetched pages a hidden window has no use for, and keeps what the
 * window comes back on: `view`, the library lists when that is the library,
 * and the search the box holds, which `App` still observes. Anything the queue
 * follows or that is still loading stays too.
 */
export function dropPageData(view: View | null): void {
  const browsing =
    view?.kind === "album" || view?.kind === "artist" || view?.kind === "playlist" ? view : null;
  clearBrowseCache({ keep: browsing });
  for (const prefix of PAGE_DATA) {
    if (prefix === "saved" && view?.kind === "library") continue;
    queryClient.removeQueries({ queryKey: [prefix], predicate: (query) => !inUse(query) });
  }
}

/**
 * Drops the page data now, and again each time a query is let go of: one that
 * was still loading finishes, or the queue stops following a playlist. Without
 * that, whatever was in use at the moment of hiding would stay for as long as
 * the window is hidden. Returns what stops it.
 */
export function dropPageDataWhileHidden(view: View | null): () => void {
  dropPageData(view);
  return queryClient.getQueryCache().subscribe((event) => {
    if (!DROPPED.includes(event.query.queryKey[0])) return;
    const released =
      event.type === "observerRemoved" ||
      (event.type === "updated" && event.query.state.fetchStatus === "idle");
    if (released && !inUse(event.query)) dropPageData(view);
  });
}

/**
 * Whether the window is hidden in the tray, for `App` to render nothing then.
 * Hiding also drops the page data. That runs in an effect, so after the views
 * have unmounted and let go of their queries.
 */
export function useTrayIdle(view: View | null): boolean {
  const hidden = useWindowHidden();
  useEffect(() => {
    if (hidden) return dropPageDataWhileHidden(view);
    // `view` cannot change while hidden: nothing is on screen to navigate with.
  }, [hidden, view]);
  return hidden;
}
