import { describe, expect, it, vi } from "vitest";
import type { Track } from "@ymusic/core";

import { followShuffle, type ShufflePage } from "./followShuffle.ts";

type More = (token: string) => Promise<ShufflePage>;
type OnPage = (added: Track[]) => void;

const track = (id: string) => ({ id: `yt:${id}` }) as Track;
const page = (ids: string[], more: string | null): ShufflePage => ({
  tracks: ids.map(track),
  more,
});
const ids = (calls: Track[][]) => calls.map((tracks) => tracks.map((t) => t.id));

/** Serves `pages` by token: the first page's token is "1", the next "2", and so on. */
function server(pages: ShufflePage[]) {
  return vi.fn<More>(async (token) => pages[Number(token) - 1]!);
}

describe("followShuffle", () => {
  it("hands on each page's new songs and drops ones already seen", async () => {
    const more = server([page(["c", "a", "d"], "2"), page(["e"], null)]);
    const pages: Track[][] = [];
    const end = await followShuffle(page(["a", "b"], "1"), {
      more,
      onPage: (added) => pages.push(added),
      stopped: () => false,
    });
    expect(end).toBe("end");
    expect(ids(pages)).toEqual([["yt:c", "yt:d"], ["yt:e"]]);
  });

  it("stops at a page of nothing but repeats", async () => {
    const more = server([page(["a", "b"], "2"), page(["c"], null)]);
    const onPage = vi.fn<OnPage>();
    const end = await followShuffle(page(["a", "b"], "1"), { more, onPage, stopped: () => false });
    expect(end).toBe("repeats");
    expect(onPage).not.toHaveBeenCalled();
    expect(more).toHaveBeenCalledTimes(1);
  });

  it("stops after the page limit, counting the first page", async () => {
    let n = 0;
    const more = vi.fn<More>(async () => page([`s${++n}`], "next"));
    const onPage = vi.fn<OnPage>();
    const end = await followShuffle(page(["a"], "next"), {
      more,
      onPage,
      stopped: () => false,
      maxPages: 3,
    });
    expect(end).toBe("limit");
    expect(more).toHaveBeenCalledTimes(2);
  });

  it("keeps what came so far when a page fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const more = vi.fn<More>(async () => {
      throw new Error("offline");
    });
    const onPage = vi.fn<OnPage>();
    const end = await followShuffle(page(["a"], "1"), { more, onPage, stopped: () => false });
    expect(end).toBe("failed");
    expect(onPage).not.toHaveBeenCalled();
  });

  it("drops a page that arrives after the queue was replaced", async () => {
    let stopped = false;
    const more = vi.fn<More>(async () => {
      stopped = true;
      return page(["b"], null);
    });
    const onPage = vi.fn<OnPage>();
    const end = await followShuffle(page(["a"], "1"), { more, onPage, stopped: () => stopped });
    expect(end).toBe("stopped");
    expect(onPage).not.toHaveBeenCalled();
  });
});
