// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import type { SearchFilter, SearchResults } from "@ymusic/core";

import type { engine as realEngine } from "./engine.ts";
import { queryClient } from "./query.ts";
import { renderWithQuery } from "./testing.tsx";
import { useYouTubeSearch } from "./useYouTubeSearch.ts";

type Engine = typeof realEngine;
const engine = vi.hoisted(() => ({
  search: vi.fn<Engine["search"]>(),
  searchMore: vi.fn<Engine["searchMore"]>(),
}));
vi.mock("./engine.ts", () => ({ engine }));

const CHIPS: SearchFilter[] = ["songs", "videos", "albums"];

function answer(filters: SearchFilter[], more: string | null = null) {
  const results = { top: null, shelves: [], filters } as unknown as SearchResults;
  return { results, more };
}

const render = (query = "daft punk") =>
  renderWithQuery((text: string) => useYouTubeSearch(text, true, true), { initialProps: query });

beforeEach(() => {
  queryClient.clear();
  engine.search
    .mockReset()
    .mockImplementation((_query, { filter } = {}) =>
      Promise.resolve(answer(filter ? [] : CHIPS, filter ? "next" : null)),
    );
  engine.searchMore.mockReset().mockResolvedValue(answer([]));
});

afterEach(cleanup);

describe("YouTube Music search", () => {
  it("offers the unfiltered answer's chips, kept while one is selected", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.filters).toEqual(CHIPS));

    act(() => result.current.setFilter("songs"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(engine.search).toHaveBeenLastCalledWith("daft punk", {
      signedOut: true,
      filter: "songs",
    });
    expect(result.current.filters).toEqual(CHIPS);
  });

  it("keeps the chips through a submit with one selected", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.filters).toEqual(CHIPS));
    act(() => result.current.setFilter("songs"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.submit("daft punk"));
    expect(result.current.filters).toEqual(CHIPS);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(engine.search).toHaveBeenLastCalledWith("daft punk", {
      signedOut: false,
      filter: "songs",
    });
    expect(result.current.filters).toEqual(CHIPS);
  });

  it("starts a new query on everything", async () => {
    const { result, rerender } = render();
    await waitFor(() => expect(result.current.filters).toEqual(CHIPS));
    act(() => result.current.setFilter("songs"));

    rerender("justice");
    expect(result.current.filter).toBeNull();
  });

  it("loads a chip's next page with the engine's handle", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.filters).toEqual(CHIPS));
    act(() => result.current.setFilter("songs"));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(engine.searchMore).toHaveBeenCalledWith("next");
  });
});
