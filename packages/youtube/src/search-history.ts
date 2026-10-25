import type { Innertube } from "youtubei.js";

/** A past search on the account. */
export interface SearchHistoryEntry {
  query: string;
  /** What removing it sends back. Null when YouTube offered no way to. */
  feedbackToken: string | null;
}

interface RawHistorySuggestion {
  suggestion?: { runs?: readonly { text?: unknown }[] };
  navigationEndpoint?: { searchEndpoint?: { query?: unknown } };
  serviceEndpoint?: { feedbackEndpoint?: { feedbackToken?: unknown } };
}

interface RawSuggestions {
  contents?: readonly {
    searchSuggestionsSectionRenderer?: {
      contents?: readonly { historySuggestionRenderer?: RawHistorySuggestion }[];
    };
  }[];
}

/**
 * The account's recent searches. YouTube Music asks for search suggestions
 * with an empty query when the search box opens, and the answer is the
 * history, as `historySuggestionRenderer`s.
 */
export async function getSearchHistory(youtube: Innertube): Promise<SearchHistoryEntry[]> {
  const response = await youtube.actions.execute("/music/get_search_suggestions", {
    input: "",
    client: "YTMUSIC",
  });
  return searchHistoryFrom(response.data as RawSuggestions);
}

/** Exported for tests. Suggestions that are not history are left out. */
export function searchHistoryFrom(data: RawSuggestions): SearchHistoryEntry[] {
  const entries: SearchHistoryEntry[] = [];
  for (const section of data.contents ?? []) {
    for (const item of section.searchSuggestionsSectionRenderer?.contents ?? []) {
      const history = item.historySuggestionRenderer;
      if (!history) continue;
      const named = history.navigationEndpoint?.searchEndpoint?.query;
      const query =
        typeof named === "string"
          ? named
          : (history.suggestion?.runs ?? []).map((run) => String(run.text ?? "")).join("");
      if (query.length === 0) continue;
      const token = history.serviceEndpoint?.feedbackEndpoint?.feedbackToken;
      entries.push({ query, feedbackToken: typeof token === "string" ? token : null });
    }
  }
  return entries;
}

/** Removes a search from the account's history, as its remove button does on the web. */
export async function removeSearchHistory(youtube: Innertube, feedbackToken: string): Promise<void> {
  await youtube.actions.execute("/feedback", {
    feedbackTokens: [feedbackToken],
    client: "YTMUSIC",
  });
}
