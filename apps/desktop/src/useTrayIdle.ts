import { useEffect } from "react";

import { inUse, queryClient } from "./query.ts";
import { dropIdlePages, type View } from "./useBrowse.ts";
import { useWindowHidden } from "./useWindowHidden.ts";

/**
 * What the pages fetch and only a visible window reads: library lists, search
 * results and the playlists a song can be added to. Browse pages go through
 * `dropIdlePages`. Stream leases (`stream`) are not here, because the player
 * reads them, and neither are song years, which are small and which the
 * player bar would fetch again as soon as it is drawn.
 */
const PAGE_DATA = ["saved", "search", "playlist-targets"] as const;

/**
 * Drops the fetched pages a hidden window has no use for, and keeps what the
 * window comes back on: `view`, the library lists when that is the library,
 * and the search the box holds, which `App` still observes. Anything the queue
 * follows or that is still loading stays too.
 */
export function dropPageData(view: View | null): void {
  const browsing =
    view?.kind === "album" || view?.kind === "artist" || view?.kind === "playlist" ? view : null;
  dropIdlePages(browsing);
  for (const prefix of PAGE_DATA) {
    if (prefix === "saved" && view?.kind === "library") continue;
    queryClient.removeQueries({ queryKey: [prefix], predicate: (query) => !inUse(query) });
  }
}

/**
 * Whether the window is hidden in the tray, for `App` to render nothing then.
 * Hiding also drops the page data. That runs in an effect, so after the views
 * have unmounted and let go of their queries.
 */
export function useTrayIdle(view: View | null): boolean {
  const hidden = useWindowHidden();
  useEffect(() => {
    if (hidden) dropPageData(view);
    // `view` cannot change while hidden: nothing is on screen to navigate with.
  }, [hidden, view]);
  return hidden;
}
