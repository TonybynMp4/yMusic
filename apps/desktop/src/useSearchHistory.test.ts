// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import type { SearchHistory } from "@ymusic/ipc";

import type { engine as realEngine } from "./engine.ts";
import { queryClient } from "./query.ts";
import { renderWithQuery } from "./testing.tsx";
import { useSearchHistory } from "./useSearchHistory.ts";

type Engine = typeof realEngine;
const engine = vi.hoisted(() => ({
  searchHistory: vi.fn<Engine["searchHistory"]>(),
  removeSearchHistory: vi.fn<Engine["removeSearchHistory"]>(),
}));
vi.mock("./engine.ts", () => ({ engine }));

interface Props {
  setting: SearchHistory;
  open: boolean;
}

function render(initialProps: Props) {
  return renderWithQuery(({ setting, open }: Props) => useSearchHistory(setting, true, open), {
    initialProps,
  });
}

const queries = (recent: { query: string }[]) => recent.map((r) => r.query);

beforeEach(() => {
  queryClient.clear();
  localStorage.clear();
  engine.searchHistory.mockReset().mockResolvedValue([
    { query: "daft punk", feedbackToken: "t1" },
    { query: "boards of canada", feedbackToken: null },
  ]);
  engine.removeSearchHistory.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("the account's recent searches", () => {
  it("are fetched each time the list opens, the last ones showing meanwhile", async () => {
    const { result, rerender } = render({ setting: "youtube", open: false });
    expect(engine.searchHistory).not.toHaveBeenCalled();

    rerender({ setting: "youtube", open: true });
    await waitFor(() =>
      expect(queries(result.current.recent)).toEqual(["daft punk", "boards of canada"]),
    );

    rerender({ setting: "youtube", open: false });
    rerender({ setting: "youtube", open: true });
    expect(queries(result.current.recent)).toEqual(["daft punk", "boards of canada"]);
    await waitFor(() => expect(engine.searchHistory).toHaveBeenCalledTimes(2));
  });

  it("drop one at once when it is removed", async () => {
    const { result } = render({ setting: "youtube", open: true });
    await waitFor(() => expect(result.current.recent).toHaveLength(2));
    expect(result.current.recent[1]!.remove).toBeNull();

    act(() => result.current.recent[0]!.remove!());
    await waitFor(() => expect(queries(result.current.recent)).toEqual(["boards of canada"]));
    expect(engine.removeSearchHistory).toHaveBeenCalledWith("t1");
  });

  it("are dropped when the setting moves to the device", async () => {
    const { result, rerender } = render({ setting: "youtube", open: true });
    await waitFor(() => expect(result.current.recent).toHaveLength(2));

    rerender({ setting: "device", open: true });
    expect(result.current.recent).toEqual([]);
    engine.searchHistory.mockReturnValue(new Promise(() => {}));
    rerender({ setting: "youtube", open: true });
    expect(result.current.recent).toEqual([]);
  });
});

describe("searches kept on the device", () => {
  it("are recorded newest first, once each", () => {
    const { result } = render({ setting: "device", open: true });
    act(() => result.current.record("one"));
    act(() => result.current.record("two"));
    act(() => result.current.record("ONE"));
    expect(queries(result.current.recent)).toEqual(["ONE", "two"]);
    expect(engine.searchHistory).not.toHaveBeenCalled();
  });
});
