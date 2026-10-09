import { describe, expect, it } from "vitest";

import { searchHistoryFrom } from "./search-history.ts";

const history = (query: string, token?: string) => ({
  historySuggestionRenderer: {
    suggestion: { runs: [{ text: query }] },
    navigationEndpoint: { searchEndpoint: { query } },
    ...(token ? { serviceEndpoint: { feedbackEndpoint: { feedbackToken: token } } } : {}),
  },
});

describe("searchHistoryFrom", () => {
  it("reads each past search with the token that removes it", () => {
    const entries = searchHistoryFrom({
      contents: [
        {
          searchSuggestionsSectionRenderer: {
            contents: [history("daft punk", "t1"), history("air", "t2")],
          },
        },
      ],
    });
    expect(entries).toEqual([
      { query: "daft punk", feedbackToken: "t1" },
      { query: "air", feedbackToken: "t2" },
    ]);
  });

  it("leaves out suggestions that are not history, and falls back to the runs", () => {
    const entries = searchHistoryFrom({
      contents: [
        {
          searchSuggestionsSectionRenderer: {
            contents: [
              { searchSuggestionRenderer: {} } as never,
              { historySuggestionRenderer: { suggestion: { runs: [{ text: "bo" }, { text: "ards" }] } } },
            ],
          },
        },
      ],
    });
    expect(entries).toEqual([{ query: "boards", feedbackToken: null }]);
  });

  it("is empty when YouTube sends nothing", () => {
    expect(searchHistoryFrom({})).toEqual([]);
  });
});
