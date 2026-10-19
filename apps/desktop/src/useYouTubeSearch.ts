import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import type { SearchFilter, SearchResults } from "@ymusic/core";

import { engine } from "./engine.ts";
import { queryClient } from "./query.ts";

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

type Pages = InfiniteData<Page, string | null>;

function searchKey(signedIn: boolean, query: string, filter: SearchFilter | null) {
  return ["search", signedIn, query, filter ?? "all"] as const;
}

/** Every page of a chip so far, as one answer. */
function combined(data: Pages): SearchResults {
  const [first, ...rest] = data.pages;
  return rest.reduce((results, page) => appended(results, page.results), first!.results);
}

/**
 * Debounced search against YouTube Music, run in the engine worker. The
 * worker keeps one InnerTube session for every search, and drops it after a
 * failure so the next search starts clean.
 *
 * One request per query, unfiltered, and one more for each chip opened, then
 * one per further page of that chip: a chip is an infinite query whose page
 * parameter is the engine's handle. The answers are kept until the query
 * changes, so going back to a chip already seen costs nothing. A page that
 * fails to load ends the chip there, keeping what arrived.
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
  const [filter, setFilter] = useState<SearchFilter | null>(null);
  // A new query starts on everything, as in YouTube Music.
  const [filterQuery, setFilterQuery] = useState(query);
  if (filterQuery !== query) {
    setFilterQuery(query);
    setFilter(null);
  }
  const [submitted, setSubmitted] = useState<string | null>(null);
  // Only the query as submitted searches with the account. Typing away and
  // back to the same text is typing again, so it no longer counts.
  const trimmed = query.trim();
  if (submitted !== null && trimmed !== submitted) setSubmitted(null);
  const recorded = useRef<string | null>(null);

  // The text searched, which trails what is typed. Longer than the library's
  // 150ms: this one leaves the machine, and a request per keystroke is both
  // slow and a good way to get rate limited. A chip is one click and a
  // submitted query is a key press, so they go at once, as does an answer
  // already here.
  const signedInFor = (text: string) => onAccount && text === submitted;
  const [settled, setSettled] = useState(trimmed);
  const now =
    trimmed === "" ||
    filter !== null ||
    signedInFor(trimmed) ||
    queryClient.getQueryData(searchKey(signedInFor(trimmed), trimmed, filter)) !== undefined;
  if (now && settled !== trimmed) setSettled(trimmed);
  const asked = now ? trimmed : settled;
  useEffect(() => {
    if (asked === trimmed) return;
    const timer = setTimeout(() => setSettled(trimmed), 350);
    return () => clearTimeout(timer);
  }, [asked, trimmed]);

  const signedIn = signedInFor(asked);
  const filterKey = filter ?? "all";
  const search = useInfiniteQuery({
    queryKey: searchKey(signedIn, asked, filter),
    queryFn: ({ pageParam }): Promise<Page> =>
      pageParam === null
        ? engine.search(asked, { signedOut: !signedIn, filter })
        : engine.searchMore(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.more,
    select: combined,
    enabled: enabled && asked !== "",
    // Dropped below when the query changes, not by time.
    gcTime: Infinity,
    // A chip whose next page failed keeps what it has rather than refetching.
    refetchOnMount: false,
    // The last answer for this chip stays up while the next query's loads; a
    // chip never shows another chip's rows.
    placeholderData: (previous, previousQuery) =>
      asked !== "" && previousQuery?.queryKey[3] === filterKey ? previous : undefined,
  });

  // Only the current query's answers are kept.
  useEffect(() => {
    if (asked === "") return;
    queryClient.removeQueries({
      queryKey: ["search"],
      predicate: ({ queryKey }) => queryKey[1] !== signedIn || queryKey[2] !== asked,
    });
  }, [asked, signedIn]);

  const submit = useCallback(
    (next: string) => {
      const text = next.trim();
      if (!onAccount || text.length === 0) return;
      recorded.current = text;
      setSubmitted(text);
    },
    [onAccount],
  );

  const record = useCallback(
    (next: string) => {
      const text = next.trim();
      // Playing a second result from the same search records nothing new.
      if (!onAccount || text.length === 0 || text === recorded.current) return;
      recorded.current = text;
      engine
        .search(text, { signedOut: false })
        .catch((error: unknown) => console.error("could not record a search", error));
    },
    [onAccount],
  );

  const results = asked === "" ? null : (search.data ?? null);
  const hasMore = filter !== null && search.hasNextPage && !search.isFetchNextPageError;
  // YouTube Music loads a chip's next rows as the list's end scrolls into view.
  const { fetchNextPage, isFetchingNextPage } = search;
  const loadMore = useCallback(() => {
    if (!hasMore || isFetchingNextPage) return;
    void fetchNextPage().then(
      ({ isFetchNextPageError, error }) =>
        isFetchNextPageError && console.error("could not load more search results", error),
    );
  }, [hasMore, isFetchingNextPage, fetchNextPage]);

  // The chips come from the unfiltered answer, kept while one is selected.
  const unfiltered =
    filter === null
      ? results
      : combinedOrNull(queryClient.getQueryData<Pages>(searchKey(signedIn, asked, null)));
  return {
    results,
    loading:
      asked !== trimmed ||
      search.isPlaceholderData ||
      (search.isFetching && !isFetchingNextPage),
    error:
      search.isError && search.data === undefined ? describe(search.error) : null,
    filter,
    setFilter,
    filters: unfiltered?.filters ?? [],
    hasMore,
    loadingMore: isFetchingNextPage,
    loadMore,
    submit,
    record,
  };
}

function combinedOrNull(data: Pages | undefined): SearchResults | null {
  return data ? combined(data) : null;
}

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
