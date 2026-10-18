import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlbumPage, PlaylistPage, Track } from "@ymusic/core";

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
const playlistPage = { title: "Mix", tracks: [], itemIds: [] } as unknown as PlaylistPage;

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

    rest({ tracks: [], itemIds: [], more: null });
    await flush();
    expect(loading).toBe(false);
    stop();
  });
});

const PAGE = 100;

function tracks(from: number, count: number): Track[] {
  return Array.from({ length: count }, (_, i) => ({ id: `yt:${from + i}` }) as unknown as Track);
}

function ids(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `item:${from + i}`);
}

function first(id: string, more: string | null) {
  return {
    page: {
      id,
      title: "Liked Music",
      tracks: tracks(0, PAGE),
      itemIds: ids(0, PAGE),
    } as unknown as PlaylistPage,
    more,
  };
}

/** Continuations named by page number, each taking `ms` to arrive. */
function continuations(pages: number, ms: number) {
  return async (handle: string) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    const n = Number(handle);
    return {
      tracks: tracks(n * PAGE, PAGE),
      itemIds: ids(n * PAGE, PAGE),
      more: n + 1 < pages ? String(n + 1) : null,
    };
  };
}

/** Every update a queue following the playlist would get. */
function follow(id: string) {
  const seen: { count: number; loading: boolean }[] = [];
  const stop = browse.followPlaylist(id, (list, loading) => seen.push({ count: list.length, loading }));
  return { seen, stop };
}

describe("a long playlist", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows its rows a few times as they arrive, not once per page", async () => {
    engine.playlist.mockResolvedValue(first("PL1", "1"));
    engine.playlistMore.mockImplementation(continuations(19, 50));
    const { seen } = follow("PL1");
    await vi.runAllTimersAsync();

    expect(engine.playlistMore).toHaveBeenCalledTimes(18);
    // The first page at once, then at most one showing per 250 ms over the
    // 900 ms the rest takes, then the end.
    expect(seen[0]).toEqual({ count: PAGE, loading: true });
    expect(seen.length).toBeLessThanOrEqual(6);
    expect(seen.at(-1)).toEqual({ count: 1900, loading: false });
    expect(seen.slice(0, -1).every((update) => update.loading)).toBe(true);
    const counts = seen.map((update) => update.count);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it("keeps each row's id, and an edit made while it loads", async () => {
    engine.playlist.mockResolvedValue(first("PL5", "1"));
    engine.playlistMore.mockImplementation(continuations(3, 50));
    const route = { kind: "playlist", id: "PL5" } as const;
    browse.browseState(route);
    await vi.advanceTimersByTimeAsync(0);
    browse.patchPage(route, (p) =>
      p.kind === "playlist" ? { ...p, page: { ...p.page, title: "Renamed" } } : p,
    );
    await vi.runAllTimersAsync();

    const done = browse.browseState(route);
    if (done.status !== "ready" || done.page.kind !== "playlist") throw new Error("not ready");
    expect(done.page.page.title).toBe("Renamed");
    expect(done.page.page.itemIds).toEqual(ids(0, 3 * PAGE));
  });

  it("tries the first page again before failing", async () => {
    engine.playlist
      .mockRejectedValueOnce(new Error("timed out"))
      .mockResolvedValueOnce(first("PL2", null));
    const { seen } = follow("PL2");
    await vi.runAllTimersAsync();

    expect(engine.playlist).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([{ count: PAGE, loading: false }]);
  });

  it("fails after the first page fails twice", async () => {
    engine.playlist.mockRejectedValue(new Error("timed out"));
    follow("PL3");
    await vi.runAllTimersAsync();

    expect(engine.playlist).toHaveBeenCalledTimes(2);
    expect(browse.browseState({ kind: "playlist", id: "PL3" })).toEqual({
      status: "error",
      error: "timed out",
    });
  });

  it("keeps the rows when a page fails, and resumes from that page", async () => {
    const more = continuations(5, 10);
    engine.playlist.mockResolvedValue(first("PL4", "1"));
    engine.playlistMore
      .mockImplementationOnce(more)
      .mockImplementationOnce(more)
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(more);
    const route = { kind: "playlist", id: "PL4" } as const;
    browse.browseState(route);
    await vi.runAllTimersAsync();

    const failed = browse.browseState(route);
    if (failed.status !== "ready" || failed.page.kind !== "playlist") throw new Error("not ready");
    expect(failed.page.page.tracks).toHaveLength(300);
    expect(failed.loadingMore).toBe(false);
    expect(failed.resume).toBeTypeOf("function");

    failed.resume!();
    expect(browse.browseState(route)).toMatchObject({ loadingMore: true });
    expect(browse.browseState(route)).not.toHaveProperty("resume");
    await vi.runAllTimersAsync();

    expect(engine.playlistMore.mock.calls.map(([handle]) => handle)).toEqual([
      "1",
      "2",
      "3",
      "3",
      "4",
    ]);
    const done = browse.browseState(route);
    if (done.status !== "ready" || done.page.kind !== "playlist") throw new Error("not ready");
    expect(done.page.page.tracks).toHaveLength(500);
    expect(done.loadingMore).toBe(false);
    expect(done).not.toHaveProperty("resume");
  });

  it("reloads when the failed page has expired, keeping the rows on screen", async () => {
    const more = continuations(4, 10);
    engine.playlist.mockResolvedValue(first("PL5", "1"));
    engine.playlistMore
      .mockImplementationOnce(more)
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("this playlist page has expired; reopen the playlist"))
      .mockImplementation(more);
    const { seen } = follow("PL5");
    await vi.runAllTimersAsync();

    const failed = browse.browseState({ kind: "playlist", id: "PL5" });
    if (failed.status !== "ready") throw new Error("not ready");
    expect(seen.at(-1)).toEqual({ count: 200, loading: false });

    failed.resume!();
    await vi.runAllTimersAsync();

    expect(engine.playlist).toHaveBeenCalledTimes(2);
    // Never back to the reloaded first page alone.
    expect(seen.map((update) => update.count)).toEqual([100, 200, 200, 400]);
    expect(seen.at(-1)).toEqual({ count: 400, loading: false });
  });

  it("keeps the rows on screen when the reload fails before catching up", async () => {
    const more = continuations(4, 10);
    engine.playlist.mockResolvedValue(first("PL6", "1"));
    engine.playlistMore
      .mockImplementationOnce(more)
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("this playlist page has expired; reopen the playlist"))
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(more);
    const route = { kind: "playlist", id: "PL6" } as const;
    const { seen } = follow("PL6");
    await vi.runAllTimersAsync();
    const expired = browse.browseState(route);
    if (expired.status !== "ready") throw new Error("not ready");
    expired.resume!();
    await vi.runAllTimersAsync();

    // The reload got its first page, then failed: still the 200 rows, with Retry.
    const failed = browse.browseState(route);
    if (failed.status !== "ready" || failed.page.kind !== "playlist") throw new Error("not ready");
    expect(failed.page.page.tracks).toHaveLength(200);
    expect(failed.resume).toBeTypeOf("function");

    failed.resume!();
    await vi.runAllTimersAsync();

    expect(engine.playlist).toHaveBeenCalledTimes(2);
    // Never back to the reloaded first page alone.
    expect(seen.slice(1).every((update) => update.count >= 200)).toBe(true);
    expect(seen.at(-1)).toEqual({ count: 400, loading: false });
  });
});

describe("a playlist changed from outside its page", () => {
  it("is fetched again on the next visit", async () => {
    const route = { kind: "playlist", id: "PL7" } as const;
    await browse.settledPage(route);
    browse.playlistChanged("PL7");
    await browse.settledPage(route);
    expect(engine.playlist).toHaveBeenCalledTimes(2);
  });

  it("is fetched again when opened by its browse id", async () => {
    const route = { kind: "playlist", id: "VLPL8" } as const;
    await browse.settledPage(route);
    browse.playlistChanged("PL8");
    await browse.settledPage(route);
    expect(engine.playlist).toHaveBeenCalledTimes(2);
  });

  it("leaves a playlist never opened uncached", () => {
    browse.playlistChanged("PL9");
    expect(engine.playlist).not.toHaveBeenCalled();
  });
});
