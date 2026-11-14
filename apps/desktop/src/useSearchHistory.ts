import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SearchHistory } from "@ymusic/ipc";

import { engine } from "./engine.ts";
import { queryClient } from "./query.ts";

const LOCAL_KEY = "ymusic.search-history";
const ACCOUNT_KEY = ["search-history"] as const;

type AccountSearch = Awaited<ReturnType<typeof engine.searchHistory>>[number];
/** How many searches the list on this device keeps. */
const LOCAL_LIMIT = 20;

export interface RecentSearch {
  query: string;
  /** Null when YouTube gave no way to remove it. */
  remove: (() => void) | null;
}

export interface SearchHistoryState {
  /** Newest first. Empty while history is off. */
  recent: RecentSearch[];
  /** Adds a search to the list on this device. The account records its own. */
  record: (query: string) => void;
}

/**
 * Where searches are kept. Signed out there is no account to keep them on,
 * so "youtube" means the list on this device.
 */
export function searchHistoryIn(setting: SearchHistory, signedIn: boolean): SearchHistory {
  return setting === "youtube" && !signedIn ? "device" : setting;
}

/**
 * Recent searches, from wherever the setting keeps them. Signed out there is
 * no account to read, so "youtube" uses the list on this device. The
 * account's list is fetched each time `open` turns true, so a search made
 * since shows, with the last one up meanwhile.
 */
export function useSearchHistory(
  setting: SearchHistory,
  signedIn: boolean,
  open: boolean,
): SearchHistoryState {
  const where = searchHistoryIn(setting, signedIn);
  const [local, setLocal] = useState<string[]>(readLocal);
  const history = useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: () =>
      engine.searchHistory().catch((error: unknown) => {
        console.error("could not read the search history", error);
        throw error;
      }),
    enabled: where === "youtube" && open,
    staleTime: 0,
  });
  const account: AccountSearch[] = history.data ?? [];

  // Dropped when the account's list stops applying, so signing in as someone
  // else never shows the last account's searches.
  useEffect(() => {
    if (where !== "youtube") queryClient.removeQueries({ queryKey: ACCOUNT_KEY });
  }, [where]);

  const saveLocal = useCallback((update: (queries: string[]) => string[]) => {
    setLocal((queries) => {
      const next = update(queries);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const record = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (where !== "device" || trimmed.length === 0) return;
      const key = trimmed.toLowerCase();
      saveLocal((queries) =>
        [trimmed, ...queries.filter((q) => q.toLowerCase() !== key)].slice(0, LOCAL_LIMIT),
      );
    },
    [where, saveLocal],
  );

  let recent: RecentSearch[] = [];
  if (where === "device") {
    recent = local.map((query) => ({
      query,
      remove: () => saveLocal((queries) => queries.filter((q) => q !== query)),
    }));
  } else if (where === "youtube") {
    recent = account.map(({ query, feedbackToken }) => ({
      query,
      remove:
        feedbackToken === null
          ? null
          : () => {
              queryClient.setQueryData<AccountSearch[]>(ACCOUNT_KEY, (entries) =>
                entries?.filter((e) => e.feedbackToken !== feedbackToken),
              );
              engine
                .removeSearchHistory(feedbackToken)
                .catch((error: unknown) => console.error("could not remove a search", error));
            },
    }));
  }
  return { recent, record };
}

function readLocal(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((q): q is string => typeof q === "string") : [];
  } catch {
    return [];
  }
}
