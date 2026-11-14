// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import type { BrowseCard } from "@ymusic/core";

import type { engine as realEngine } from "./engine.ts";
import { LIKED_MUSIC } from "./libraryPlaylists.ts";
import { queryClient } from "./query.ts";
import { renderWithQuery } from "./testing.tsx";
import { useLibraryPlaylists } from "./useLibraryPlaylists.ts";

const engine = vi.hoisted(() => ({
  libraryPlaylists: vi.fn<(typeof realEngine)["libraryPlaylists"]>(),
}));
vi.mock("./engine.ts", () => ({ engine }));

const card = (id: string) =>
  ({ kind: "playlist", id, title: id, subtitle: null, thumbnails: [] }) as BrowseCard;
const ids = (cards: BrowseCard[]) => cards.map((c) => c.id);

beforeEach(() => {
  queryClient.clear();
  engine.libraryPlaylists.mockReset().mockResolvedValue([card(LIKED_MUSIC), card("PLold")]);
});

afterEach(cleanup);

describe("the account's playlists", () => {
  it("shows a new playlist after Liked Music until YouTube lists it", async () => {
    const { result } = renderWithQuery(() => useLibraryPlaylists("me"));
    await waitFor(() => expect(ids(result.current.playlists)).toEqual([LIKED_MUSIC, "PLold"]));

    act(() => result.current.created(card("PLnew")));
    expect(ids(result.current.playlists)).toEqual([LIKED_MUSIC, "PLnew", "PLold"]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ids(result.current.playlists)).toEqual([LIKED_MUSIC, "PLnew", "PLold"]);
  });

  it("does not bring a listed playlist back once it is removed elsewhere", async () => {
    const { result } = renderWithQuery(() => useLibraryPlaylists("me"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    engine.libraryPlaylists.mockResolvedValue([card(LIKED_MUSIC), card("PLnew"), card("PLold")]);
    act(() => result.current.created(card("PLnew")));
    await waitFor(() => expect(engine.libraryPlaylists).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Deleted on another device, then a Refresh.
    engine.libraryPlaylists.mockResolvedValue([card(LIKED_MUSIC), card("PLold")]);
    act(() => result.current.reload());
    await waitFor(() => expect(engine.libraryPlaylists).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(ids(result.current.playlists)).toEqual([LIKED_MUSIC, "PLold"]));
  });

  it("hides a playlist just deleted that YouTube still lists", async () => {
    const { result } = renderWithQuery(() => useLibraryPlaylists("me"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.deleted("PLold"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ids(result.current.playlists)).toEqual([LIKED_MUSIC]);
  });

  it("fetches the list again when the account comes back", async () => {
    const { result, rerender } = renderWithQuery(
      (account: string | null) => useLibraryPlaylists(account),
      {
        initialProps: "me" as string | null,
      },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender(null);
    expect(result.current.playlists).toEqual([]);
    rerender("me");
    // The last list shows while it is fetched again.
    expect(ids(result.current.playlists)).toEqual([LIKED_MUSIC, "PLold"]);
    await waitFor(() => expect(engine.libraryPlaylists).toHaveBeenCalledTimes(2));
  });

  it("drops a new and a deleted playlist when the account changes", async () => {
    const { result, rerender } = renderWithQuery(
      (account: string) => useLibraryPlaylists(account),
      {
        initialProps: "me",
      },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.created(card("PLnew")));
    act(() => result.current.deleted("PLold"));
    expect(ids(result.current.playlists)).toEqual([LIKED_MUSIC, "PLnew"]);

    rerender("them");
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ids(result.current.playlists)).toEqual([LIKED_MUSIC, "PLold"]);
  });
});

describe("a new playlist YouTube does not list yet", () => {
  afterEach(() => vi.useRealTimers());

  const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  /** How long a fetch takes here. The next wait starts once one has ended and rendered. */
  const FETCH_MS = 50;
  /** Longer than a fetch and its render, far shorter than the 2 s between waits. */
  const SETTLE_MS = 200;
  /** When each fetch started, on the fake clock. */
  let fetchedAt: number[] = [];
  function listing(...cards: BrowseCard[]) {
    engine.libraryPlaylists.mockImplementation(() => {
      fetchedAt.push(Date.now());
      return new Promise((resolve) => setTimeout(() => resolve(cards), FETCH_MS));
    });
  }

  async function createUnlisted() {
    const rendered = renderWithQuery(() => useLibraryPlaylists("me"));
    await waitFor(() => expect(rendered.result.current.loading).toBe(false));
    vi.useFakeTimers();
    fetchedAt = [];
    listing(card(LIKED_MUSIC), card("PLold"));
    act(() => rendered.result.current.created(card("PLnew")));
    await wait(SETTLE_MS);
    // The first load, then the fetch `created` asks for.
    expect(engine.libraryPlaylists).toHaveBeenCalledTimes(2);
    return rendered;
  }

  it("fetches the list again 5 times, 2 s further apart each time", async () => {
    await createUnlisted();
    await wait(60_000);
    expect(engine.libraryPlaylists).toHaveBeenCalledTimes(7);
    // Each wait starts when the fetch before it ends.
    const waits = fetchedAt.slice(1).map((at, i) => at - fetchedAt[i]! - FETCH_MS);
    expect(waits).toHaveLength(5);
    for (const [attempt, waited] of waits.entries()) {
      const expected = (attempt + 1) * 2000;
      expect(waited).toBeGreaterThanOrEqual(expected);
      expect(waited).toBeLessThan(expected + SETTLE_MS);
    }
  });

  it("stops once the list has it", async () => {
    const { result } = await createUnlisted();
    listing(card(LIKED_MUSIC), card("PLnew"), card("PLold"));
    await wait(2000 + SETTLE_MS);
    expect(engine.libraryPlaylists).toHaveBeenCalledTimes(3);
    await wait(60_000);
    expect(engine.libraryPlaylists).toHaveBeenCalledTimes(3);
    expect(ids(result.current.playlists)).toEqual([LIKED_MUSIC, "PLnew", "PLold"]);
  });

  it("starts counting again when another playlist is created", async () => {
    const { result } = await createUnlisted();
    await wait(60_000);
    expect(engine.libraryPlaylists).toHaveBeenCalledTimes(7);
    act(() => result.current.created(card("PLnewer")));
    await wait(SETTLE_MS);
    expect(engine.libraryPlaylists).toHaveBeenCalledTimes(8);
    await wait(2000);
    expect(engine.libraryPlaylists).toHaveBeenCalledTimes(9);
  });
});
