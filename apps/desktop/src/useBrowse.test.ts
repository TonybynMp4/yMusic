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

/** The module keeps its cache at the top level, so each test gets a fresh copy. */
let browse: typeof import("./useBrowse.ts");

const album = (id: string) => ({ kind: "album", id }) as const;
const playlistPage = { title: "Mix", tracks: [] } as unknown as PlaylistPage;

/** Opens an album and waits for it, leaving nothing following it. */
async function visit(id: string): Promise<void> {
  await browse.settledPage(album(id));
}

function albumFetches(id: string): number {
  return engine.album.mock.calls.filter(([asked]) => asked === id).length;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  vi.resetModules();
  engine.album.mockReset().mockImplementation(async (id) => ({ title: id }) as AlbumPage);
  engine.playlist.mockReset().mockResolvedValue({ page: playlistPage, more: null });
  engine.playlistMore.mockReset();
  browse = await import("./useBrowse.ts");
});

describe("the browse page cache", () => {
  it("keeps the 10 most recent pages and fetches an older one again", async () => {
    for (let i = 0; i <= 10; i++) await visit(`a${i}`);
    expect(engine.album).toHaveBeenCalledTimes(11);

    for (let i = 1; i <= 10; i++) await visit(`a${i}`);
    expect(engine.album).toHaveBeenCalledTimes(11);

    await visit("a0");
    expect(albumFetches("a0")).toBe(2);
  });

  it("moves a page opened again to the back of the line", async () => {
    for (let i = 0; i < 10; i++) await visit(`a${i}`);
    await visit("a0");
    await visit("a10");

    await visit("a0");
    expect(albumFetches("a0")).toBe(1);
    await visit("a1");
    expect(albumFetches("a1")).toBe(2);
  });

  it("never drops a page something follows, and drops it once nothing does", async () => {
    const stop = browse.followPlaylist("p", () => {});
    await flush();
    for (let i = 0; i < 10; i++) await visit(`a${i}`);

    // Eleven pages: the followed playlist is the oldest, so a0 went instead.
    await visit("a1");
    expect(albumFetches("a1")).toBe(1);
    await visit("a0");
    expect(albumFetches("a0")).toBe(2);

    stop();
    await visit("a10");
    browse.followPlaylist("p", () => {})();
    expect(engine.playlist).toHaveBeenCalledTimes(2);
  });

  it("never drops a page still loading", async () => {
    let arrive: (first: Awaited<ReturnType<Engine["playlist"]>>) => void = () => {};
    engine.playlist.mockImplementationOnce(() => new Promise((resolve) => (arrive = resolve)));
    browse.followPlaylist("slow", () => {})();
    for (let i = 0; i < 10; i++) await visit(`a${i}`);

    arrive({ page: playlistPage, more: null });
    await browse.settledPage({ kind: "playlist", id: "slow" });
    expect(engine.playlist).toHaveBeenCalledTimes(1);
  });

  it("never drops a playlist still loading more rows", async () => {
    let rest: (more: Awaited<ReturnType<Engine["playlistMore"]>>) => void = () => {};
    engine.playlist.mockResolvedValueOnce({ page: playlistPage, more: "next" });
    engine.playlistMore.mockImplementationOnce(() => new Promise((resolve) => (rest = resolve)));
    browse.followPlaylist("long", () => {})();
    await flush();
    for (let i = 0; i < 10; i++) await visit(`a${i}`);

    let loading = true;
    const stop = browse.followPlaylist("long", (_, more) => (loading = more));
    expect(engine.playlist).toHaveBeenCalledTimes(1);
    expect(loading).toBe(true);

    rest({ tracks: [], more: null });
    await flush();
    expect(loading).toBe(false);
    stop();
  });
});
