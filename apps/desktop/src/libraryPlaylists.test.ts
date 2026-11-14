import { describe, expect, it } from "vitest";
import type { BrowseCard } from "@ymusic/core";

import {
  addGone,
  addPending,
  dropPending,
  itemsFor,
  LIKED_MUSIC,
  mergePlaylists,
  prunePending,
  retryDelay,
  unscoped,
  type Scoped,
} from "./libraryPlaylists.ts";

const card = (id: string): BrowseCard => ({ kind: "playlist", id, title: id }) as BrowseCard;
const ids = (cards: readonly BrowseCard[]) => cards.map((c) => c.id);

const liked = card(LIKED_MUSIC);

describe("mergePlaylists", () => {
  it("shows the fetched list as is when nothing is pending or deleted", () => {
    expect(ids(mergePlaylists([liked, card("a"), card("b")], [], []))).toEqual(["LM", "a", "b"]);
  });

  it("puts new playlists after Liked Music and before the rest", () => {
    const merged = mergePlaylists([card("a"), liked, card("b")], [card("new2"), card("new1")], []);
    expect(ids(merged)).toEqual(["LM", "new2", "new1", "a", "b"]);
  });

  it("puts new playlists first when the list has no Liked Music", () => {
    expect(ids(mergePlaylists([card("a")], [card("new")], []))).toEqual(["new", "a"]);
  });

  it("hides deleted playlists", () => {
    expect(ids(mergePlaylists([liked, card("a"), card("b")], [], ["a"]))).toEqual(["LM", "b"]);
    expect(ids(mergePlaylists([liked, card("a")], [card("new")], ["a"]))).toEqual(["LM", "new"]);
  });
});

describe("pending playlists", () => {
  it("adds a new playlist first, once", () => {
    let pending = addPending(unscoped(), "me", card("a"));
    pending = addPending(pending, "me", card("b"));
    pending = addPending(pending, "me", card("a"));
    expect(pending.account).toBe("me");
    expect(ids(pending.items)).toEqual(["a", "b"]);
  });

  it("drops another account's pending playlists when this one creates one", () => {
    const theirs = addPending(unscoped(), "them", card("a"));
    const pending = addPending(theirs, "me", card("b"));
    expect(pending.account).toBe("me");
    expect(ids(pending.items)).toEqual(["b"]);
  });

  it("only shows them to the account that made them", () => {
    const pending = addPending(unscoped(), "me", card("a"));
    expect(ids(itemsFor(pending, "me"))).toEqual(["a"]);
    expect(itemsFor(pending, "them")).toEqual([]);
    expect(itemsFor(pending, null)).toEqual([]);
  });

  it("drops a deleted playlist, keeping the account", () => {
    const pending: Scoped<BrowseCard> = { account: "them", items: [card("a"), card("b")] };
    const dropped = dropPending(pending, "a");
    expect(dropped.account).toBe("them");
    expect(ids(dropped.items)).toEqual(["b"]);
  });
});

describe("prunePending", () => {
  const pending: Scoped<BrowseCard> = { account: "me", items: [card("a"), card("b")] };

  it("takes out the playlists the fetched list has", () => {
    const pruned = prunePending(pending, "me", [liked, card("a")]);
    expect(pruned.account).toBe("me");
    expect(ids(pruned.items)).toEqual(["b"]);
  });

  it("returns the same state when the list has none of them", () => {
    expect(prunePending(pending, "me", [liked, card("c")])).toBe(pending);
  });

  it("leaves another account's pending playlists alone", () => {
    expect(prunePending(pending, "them", [card("a"), card("b")])).toBe(pending);
  });

  it("does not bring a placeholder back once the list had it", () => {
    const pruned = prunePending(pending, "me", [card("a")]);
    expect(ids(prunePending(pruned, "me", []).items)).toEqual(["b"]);
  });
});

describe("addGone", () => {
  it("collects deleted playlists for the account", () => {
    const gone = addGone(addGone(unscoped(), "me", "a"), "me", "b");
    expect(gone).toEqual({ account: "me", items: ["b", "a"] });
  });

  it("drops another account's deleted playlists", () => {
    const gone = addGone(addGone(unscoped(), "them", "a"), "me", "b");
    expect(gone).toEqual({ account: "me", items: ["b"] });
  });
});

describe("retryDelay", () => {
  it("waits 2 s longer each time", () => {
    expect([0, 1, 2, 3, 4].map(retryDelay)).toEqual([2000, 4000, 6000, 8000, 10000]);
  });
});
