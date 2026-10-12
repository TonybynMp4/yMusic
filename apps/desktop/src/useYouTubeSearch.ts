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

interface Loaded {
  results: SearchResults | null;
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
 * One request per query, unfiltered, and one more for each chip opened. The
 * answers are kept until the query changes, so going back to a chip already
 * seen costs nothing.
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
  const cache = useRef(new Map<string, SearchResults>());

  useEffect(() => {
    if (!enabled) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setLoaded({ results: null, filter: null, loading: false, error: null });
      setFilters([]);
      return;
    }
    const signedIn = onAccount && trimmed === submitted;
    const prefix = `${signedIn}|${trimmed}|`;
    for (const key of cache.current.keys()) {
      if (!key.startsWith(prefix)) cache.current.delete(key);
    }
    const key = prefix + (filter ?? "all");
    const show = (results: SearchResults) => {
      setLoaded({ results, filter, loading: false, error: null });
      if (filter === null) setFilters(results.filters);
    };
    const cached = cache.current.get(key);
    if (cached) {
      show(cached);
      return;
    }

    let cancelled = false;
    setLoaded((s) => ({ ...s, loading: true }));
    // Longer than the library's 150ms: this one leaves the machine, and a
    // request per keystroke is both slow and a good way to get rate limited.
    // A chip is one click and a submitted query is a key press, so they go at once.
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const results = await engine.search(trimmed, { signedOut: !signedIn, filter });
            cache.current.set(key, results);
            if (!cancelled) show(results);
          } catch (error) {
            if (!cancelled) {
              setLoaded({ results: null, filter, loading: false, error: describe(error) });
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

  return {
    results: loaded.filter === filter ? loaded.results : null,
    loading: loaded.loading || loaded.filter !== filter,
    error: loaded.filter === filter ? loaded.error : null,
    filter,
    setFilter,
    filters,
    submit,
    record,
  };
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `YouTube search failed: ${message}`;
}
