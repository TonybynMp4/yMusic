// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import type { BrowseCard } from "@ymusic/core";

import type { engine as realEngine } from "./engine.ts";
import { queryClient } from "./query.ts";
import { renderWithQuery } from "./testing.tsx";
import { LIKED_MUSIC, useLibraryPlaylists } from "./useLibraryPlaylists.ts";

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
    const { result, rerender } = renderWithQuery((account: string | null) => useLibraryPlaylists(account), {
      initialProps: "me" as string | null,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender(null);
    expect(result.current.playlists).toEqual([]);
    rerender("me");
    // The last list shows while it is fetched again.
    expect(ids(result.current.playlists)).toEqual([LIKED_MUSIC, "PLold"]);
    await waitFor(() => expect(engine.libraryPlaylists).toHaveBeenCalledTimes(2));
  });
});
