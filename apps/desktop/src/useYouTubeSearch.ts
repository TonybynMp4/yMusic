import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchFilter, SearchResults } from "@ymusic/core";

import { engine } from "./engine.ts";

export interface YouTubeSearchState {
  /** The results for `filter`, or null before the first arrive. */
  results: SearchResults | null;
  loading: boolean;
  error: string | null;
  /** The selected chip, null for everything. A new query clears it. */
  filter: SearchFilter | null;
  setFilter: (filter: SearchFilter | null) => void;
  /** The chips the unfiltered search offered, kept while one is selected. */
  filters: SearchFilter[];
  /** Whether the selected chip has rows still to load. */
  hasMore: boolean;
  loadingMore: boolean;
  /** Fetches the selected chip's next page. Does nothing while one is loading. */
  loadMore: () => void;
  /**
   * Searches `query` with the account now, which records it there and shows
   * its personalised results. What Enter and picking a past search do.
   */
  submit: (query: string) => void;
  /**
   * Records `query` on the account without changing what is shown. What
   * playing or opening a result does.
   */
  record: (query: string) => void;
}

/** One answer and the handle for its next page, if a chip has one. */
interface Page {
  results: SearchResults;
  more: string | null;
}

interface Loaded {
  results: SearchResults | null;
  more: string | null;
  loadingMore: boolean;
  /** The filter `results` answer, so a chip never shows another chip's rows. */
  filter: SearchFilter | null;
  loading: boolean;
  error: string | null;
}

/**
 * Debounced search against YouTube Music, run in the engine worker. The
 * worker keeps one InnerTube session for every search, and drops it after a
 * failure so the next search starts clean.
 *
 * One request per query, unfiltered, and one more for each chip opened, then
 * one per further page of that chip. The answers are kept until the query
 * changes, so going back to a chip already seen costs nothing.
 *
 * Searches made while typing go out without the account, even with
 * `onAccount`: YouTube records every signed-in search, so each pause in typing
 * would land in the account's history. Only a submitted query searches with
 * the account.
 */
export function useYouTubeSearch(
  query: string,
  enabled: boolean,
  onAccount: boolean,
): YouTubeSearchState {
  const [loaded, setLoaded] = useState<Loaded>({
    results: null,
    more: null,
    loadingMore: false,
    filter: null,
    loading: false,
    error: null,
  });
  const [filter, setFilter] = useState<SearchFilter | null>(null);
  const [filters, setFilters] = useState<SearchFilter[]>([]);
  // A new query starts on everything, as in YouTube Music.
  const [filterQuery, setFilterQuery] = useState(query);
  if (filterQuery !== query) {
    setFilterQuery(query);
    setFilter(null);
  }
  const [submitted, setSubmitted] = useState<string | null>(null);
  // Only the query as submitted searches with the account. Typing away and
  // back to the same text is typing again, so it no longer counts.
  if (submitted !== null && query.trim() !== submitted) setSubmitted(null);
  const recorded = useRef<string | null>(null);
  const cache = useRef(new Map<string, Page>());
  // The cache key of what is on screen, so a page that arrives after the
  // query or chip changed is kept for later but not shown.
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      shown.current = null;
      setLoaded({ ...EMPTY, filter: null });
      setFilters([]);
      return;
    }
    const signedIn = onAccount && trimmed === submitted;
    const prefix = `${signedIn}|${trimmed}|`;
    for (const key of cache.current.keys()) {
      if (!key.startsWith(prefix)) cache.current.delete(key);
    }
    const key = prefix + (filter ?? "all");
    shown.current = key;
    const show = ({ results, more }: Page) => {
      setLoaded({ ...EMPTY, results, more, filter });
      if (filter === null) setFilters(results.filters);
    };
    const cached = cache.current.get(key);
    if (cached) {
      show(cached);
      return;
    }

    let cancelled = false;
    setLoaded((s) => ({ ...s, loading: true, more: null, loadingMore: false }));
    // Longer than the library's 150ms: this one leaves the machine, and a
    // request per keystroke is both slow and a good way to get rate limited.
    // A chip is one click and a submitted query is a key press, so they go at once.
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const page = await engine.search(trimmed, { signedOut: !signedIn, filter });
            cache.current.set(key, page);
            if (!cancelled) show(page);
          } catch (error) {
            if (!cancelled) {
              setLoaded({ ...EMPTY, filter, error: describe(error) });
            }
          }
        })();
      },
      filter === null && !signedIn ? 350 : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, enabled, onAccount, submitted, filter]);

  const submit = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (!onAccount || trimmed.length === 0) return;
      recorded.current = trimmed;
      setSubmitted(trimmed);
    },
    [onAccount],
  );

  const record = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      // Playing a second result from the same search records nothing new.
      if (!onAccount || trimmed.length === 0 || trimmed === recorded.current) return;
      recorded.current = trimmed;
      engine
        .search(trimmed, { signedOut: false })
        .catch((error: unknown) => console.error("could not record a search", error));
    },
    [onAccount],
  );

  // YouTube Music loads a chip's next rows as the list's end scrolls into view.
  const { more, loadingMore } = loaded;
  const loadMore = useCallback(() => {
    const key = shown.current;
    if (more === null || loadingMore || key === null) return;
    setLoaded((s) => ({ ...s, loadingMore: true }));
    void (async () => {
      let next: Page | null = null;
      try {
        const page = await engine.searchMore(more);
        const before = cache.current.get(key);
        const results = before ? appended(before.results, page.results) : page.results;
        next = { results, more: page.more };
        cache.current.set(key, next);
      } catch (error) {
        // What arrived stays; the chip just ends there.
        console.error("could not load more search results", error);
      }
      if (shown.current !== key) return;
      setLoaded((s) =>
        next ? { ...s, ...next, loadingMore: false } : { ...s, more: null, loadingMore: false },
      );
    })();
  }, [more, loadingMore]);

  const current = loaded.filter === filter;
  return {
    results: current ? loaded.results : null,
    loading: loaded.loading || !current,
    error: current ? loaded.error : null,
    filter,
    setFilter,
    filters,
    hasMore: current && filter !== null && more !== null,
    loadingMore: current && loadingMore,
    loadMore,
    submit,
    record,
  };
}

const EMPTY: Omit<Loaded, "filter"> = {
  results: null,
  more: null,
  loadingMore: false,
  loading: false,
  error: null,
};

/** `next` page's rows after `results`', shelf by shelf. */
function appended(results: SearchResults, next: SearchResults): SearchResults {
  const shelves = results.shelves.map((shelf) => {
    const more = next.shelves.find((s) => s.filter === shelf.filter);
    if (shelf.kind === "tracks" && more?.kind === "tracks") {
      return { ...shelf, tracks: [...shelf.tracks, ...more.tracks] };
    }
    if (shelf.kind === "cards" && more?.kind === "cards") {
      return { ...shelf, cards: [...shelf.cards, ...more.cards] };
    }
    return shelf;
  });
  const added = next.shelves.filter((s) => !results.shelves.some((r) => r.filter === s.filter));
  return { ...results, shelves: [...shelves, ...added] };
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `YouTube search failed: ${message}`;
}
