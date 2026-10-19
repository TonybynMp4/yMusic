import { QueryClient, type Query, type QueryKey } from "@tanstack/react-query";

/** When this run started. Data from before it came from a persister. */
const launched = Date.now();

/**
 * What the engine has fetched this run: browse pages, search results, the
 * library and song years, each under a key whose first part names its hook.
 * One client for the app, used from React through the provider in `main.tsx`
 * and from outside it (the queue following a playlist, menus).
 *
 * A page fetched this run stays fresh for the run, as the hand-rolled caches
 * did, and is fetched again only when something invalidates it. A page from an
 * earlier run, which only a persister could supply, is stale at once: it
 * shows straight away and refreshes in the background. That is the seam for
 * the planned SQLite page cache (docs/browse.md).
 *
 * Nothing retries unless its query says so, and requests go out whatever
 * `navigator.onLine` says: they leave through Rust, not the webview.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: (query) => (query.state.dataUpdatedAt < launched ? 0 : Infinity),
      retry: false,
      networkMode: "always",
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

/** Whether anything shows or loads `query`, which keeps it from being dropped. */
export function inUse(query: Query): boolean {
  return query.getObserversCount() > 0 || query.state.fetchStatus !== "idle";
}

/**
 * Keeps at most `max` queries under `prefix`, dropping those that come first
 * in `order` (oldest first) and are not in use. The one just added stays. Runs whenever one is added.
 */
export function capQueries(
  prefix: QueryKey,
  max: number,
  order: (queries: Query[]) => Query[] = (queries) => queries,
): void {
  const cache = queryClient.getQueryCache();
  cache.subscribe((event) => {
    if (event.type !== "added" || !under(event.query.queryKey, prefix)) return;
    const all = cache.findAll({ queryKey: prefix });
    let over = all.length - max;
    for (const query of order(all)) {
      if (over <= 0) return;
      if (query === event.query || inUse(query)) continue;
      cache.remove(query);
      over--;
    }
  });
}

function under(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((part, i) => key[i] === part);
}
