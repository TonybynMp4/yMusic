import { QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlbumPage, PlaylistPage } from "@ymusic/core";

import type { engine as realEngine } from "./engine.ts";

type Engine = typeof realEngine;

const engine = vi.hoisted(() => ({
  album: vi.fn<Engine["album"]>(),
  playlist: vi.fn<Engine["playlist"]>(),
  playlistMore: vi.fn<Engine["playlistMore"]>(),
}));

// The real engine starts a worker; these tests only need what it returns.
vi.mock("./engine.ts", () => ({ engine }));

/** The cache is a module-level client, so each test gets a fresh copy. */
let browse: typeof import("./useBrowse.ts");
let queryClient: typeof import("./query.ts").queryClient;
let dropPageData: typeof import("./useTrayIdle.ts").dropPageData;

const album = (id: string) => ({ kind: "album", id }) as const;
const playlistPage = { title: "Mix", tracks: [], itemIds: [] } as unknown as PlaylistPage;

const has = (...key: unknown[]) => queryClient.getQueryData(key) !== undefined;

beforeEach(async () => {
  vi.resetModules();
  engine.album.mockReset().mockImplementation(async (id) => ({ title: id }) as AlbumPage);
  engine.playlist.mockReset().mockResolvedValue({ page: playlistPage, more: null });
  browse = await import("./useBrowse.ts");
  ({ queryClient } = await import("./query.ts"));
  ({ dropPageData } = await import("./useTrayIdle.ts"));
});

describe("hiding in the tray", () => {
  it("drops the browse pages, apart from the one the window comes back on", async () => {
    await browse.settledPage(album("a"));
    await browse.settledPage(album("b"));

    dropPageData(album("b"));

    expect(has("browse", "album", "a")).toBe(false);
    expect(has("browse", "album", "b")).toBe(true);
  });

  it("drops every browse page when the window comes back on another kind of view", async () => {
    await browse.settledPage(album("a"));

    dropPageData({ kind: "settings", id: "" });

    expect(has("browse", "album", "a")).toBe(false);
  });

  it("keeps a playlist the queue follows", async () => {
    const stop = browse.followPlaylist("mix", () => {});
    await vi.waitFor(() => expect(has("browse", "playlist", "mix")).toBe(true));

    dropPageData(null);
    expect(has("browse", "playlist", "mix")).toBe(true);

    stop();
    dropPageData(null);
    expect(has("browse", "playlist", "mix")).toBe(false);
  });

  it("keeps a page that is still loading", async () => {
    let arrive!: (page: AlbumPage) => void;
    engine.album.mockReturnValueOnce(new Promise((resolve) => (arrive = resolve)));
    const loading = browse.settledPage(album("slow"));

    dropPageData(null);
    arrive({ title: "slow" } as AlbumPage);
    await loading;

    expect(engine.album).toHaveBeenCalledTimes(1);
  });

  it("keeps stream leases and song years", () => {
    queryClient.setQueryData(["stream", "high", "yt:a"], { url: "https://example/a" });
    queryClient.setQueryData(["song-year", "a"], 2001);

    dropPageData(null);

    expect(has("stream", "high", "yt:a")).toBe(true);
    expect(has("song-year", "a")).toBe(true);
  });

  it("drops library lists, search results and playlist targets nothing shows", () => {
    queryClient.setQueryData(["saved", "me", "albums", "recent"], []);
    queryClient.setQueryData(["search", true, "daft", "all"], { pages: [] });
    queryClient.setQueryData(["playlist-targets", "a"], []);

    dropPageData(null);

    expect(has("saved", "me", "albums", "recent")).toBe(false);
    expect(has("search", true, "daft", "all")).toBe(false);
    expect(has("playlist-targets", "a")).toBe(false);
  });

  it("keeps the library lists when the window comes back on the library", () => {
    queryClient.setQueryData(["saved", "me", "albums", "recent"], []);

    dropPageData({ kind: "library", id: "" });

    expect(has("saved", "me", "albums", "recent")).toBe(true);
  });

  it("keeps the search the box still holds", () => {
    const key = ["search", true, "daft", "all"];
    queryClient.setQueryData(key, { pages: [] });
    const stop = new QueryObserver(queryClient, { queryKey: key, enabled: false }).subscribe(
      () => {},
    );

    dropPageData({ kind: "settings", id: "" });
    expect(has(...key)).toBe(true);
    stop();
  });
});
