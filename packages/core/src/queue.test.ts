import { describe, expect, it } from "vitest";
import type { Track, TrackId } from "./domain.ts";
import {
  PLAY_HISTORY_MAX_AGE_MS,
  PLAY_HISTORY_MAX_ENTRIES,
  playHistoryWeight,
  recencyWeight,
  recordPlay,
} from "./fewer-repeats.ts";
import {
  currentTrack,
  emptyQueue,
  peekNext,
  queueReducer,
  type QueueAction,
  type QueueState,
} from "./queue.ts";

const track = (id: string): Track => ({
  id: `local:${id}` as TrackId,
  title: id.toUpperCase(),
  artists: [{ name: "Test", channelId: null }],
  album: null,
  albumId: null,
  durationMs: 180_000,
  thumbnails: [],
  isExplicit: false,
  year: null,
});

const tracks = ["a", "b", "c", "d"].map(track);

const apply = (state: QueueState, ...actions: QueueAction[]): QueueState =>
  actions.reduce(queueReducer, state);

const loaded = (startIndex = 0) =>
  queueReducer(emptyQueue, { type: "setQueue", tracks, startIndex });

const titles = (state: QueueState) =>
  state.order.map((i) => state.items[i]!.id.replace("local:", ""));

describe("queueReducer", () => {
  it("starts at the requested track", () => {
    expect(currentTrack(loaded(2))?.id).toBe("local:c");
  });

  it("advances and stops at the end when repeat is off", () => {
    const atEnd = apply(loaded(3), { type: "next", reason: "trackEnded" });
    expect(atEnd.cursor).toBeNull();
    expect(currentTrack(atEnd)).toBeNull();
  });

  it("leaves the cursor alone when the user skips past the end", () => {
    // A user skip at the end is a no-op, not a stop: the track keeps playing.
    const atEnd = apply(loaded(3), { type: "next", reason: "user" });
    expect(currentTrack(atEnd)?.id).toBe("local:d");
  });

  it("wraps with repeat all", () => {
    const wrapped = apply(
      loaded(3),
      { type: "setRepeat", repeat: "all" },
      { type: "next", reason: "trackEnded" },
    );
    expect(currentTrack(wrapped)?.id).toBe("local:a");
  });

  it("holds the track on repeat one only when it ended on its own", () => {
    const repeating = apply(loaded(1), { type: "setRepeat", repeat: "one" });
    expect(currentTrack(apply(repeating, { type: "next", reason: "trackEnded" }))?.id).toBe(
      "local:b",
    );
    expect(currentTrack(apply(repeating, { type: "next", reason: "user" }))?.id).toBe("local:c");
  });

  it("moves a track down, keeping the playing one", () => {
    const moved = apply(loaded(1), { type: "move", from: 0, to: 2 });
    expect(titles(moved)).toEqual(["b", "c", "a", "d"]);
    expect(currentTrack(moved)?.id).toBe("local:b");
  });

  it("moves a track up past the playing one", () => {
    const moved = apply(loaded(1), { type: "move", from: 3, to: 0 });
    expect(titles(moved)).toEqual(["d", "a", "b", "c"]);
    expect(currentTrack(moved)?.id).toBe("local:b");
  });

  it("moves the playing track without interrupting it", () => {
    const moved = apply(loaded(0), { type: "move", from: 0, to: 3 });
    expect(titles(moved)).toEqual(["b", "c", "d", "a"]);
    expect(currentTrack(moved)?.id).toBe("local:a");
    expect(peekNext(moved)).toBeNull();
  });

  it("keeps a move made unshuffled when shuffle goes on and off", () => {
    const moved = apply(
      loaded(0),
      { type: "move", from: 3, to: 1 },
      { type: "setShuffle", shuffle: true },
      { type: "setShuffle", shuffle: false },
    );
    expect(titles(moved)).toEqual(["a", "d", "b", "c"]);
  });

  it("moves within the shuffled order only", () => {
    const shuffled = apply(loaded(0), { type: "setShuffle", shuffle: true, rng: () => 0 });
    const before = titles(shuffled);
    const moved = apply(shuffled, { type: "move", from: 3, to: 1 });
    expect(titles(moved)).toEqual([before[0], before[3], before[1], before[2]]);
    expect(moved.items).toBe(shuffled.items);
  });

  it("ignores a move out of range", () => {
    const state = loaded(0);
    expect(apply(state, { type: "move", from: 0, to: 4 })).toBe(state);
  });

  it("inserts enqueueNext directly after the playing track", () => {
    const state = apply(loaded(0), { type: "enqueueNext", tracks: [track("x")] });
    expect(titles(state)).toEqual(["a", "x", "b", "c", "d"]);
    expect(peekNext(state)?.id).toBe("local:x");
  });

  it("appends enqueueLast at the end", () => {
    const state = apply(loaded(0), { type: "enqueueLast", tracks: [track("x")] });
    expect(titles(state)).toEqual(["a", "b", "c", "d", "x"]);
  });

  it("keeps playing the same track when an earlier one is removed", () => {
    const state = apply(loaded(2), { type: "remove", trackId: "local:a" as TrackId });
    expect(currentTrack(state)?.id).toBe("local:c");
    expect(titles(state)).toEqual(["b", "c", "d"]);
  });

  it("moves to the following track when the playing one is removed", () => {
    const state = apply(loaded(1), { type: "remove", trackId: "local:b" as TrackId });
    expect(currentTrack(state)?.id).toBe("local:c");
  });

  it("clears the cursor when the last remaining track is removed", () => {
    const single = queueReducer(emptyQueue, { type: "setQueue", tracks: [track("a")] });
    const state = apply(single, { type: "remove", trackId: "local:a" as TrackId });
    expect(state.cursor).toBeNull();
    expect(state.items).toEqual([]);
  });

  it("clears only what comes after the current track", () => {
    const state = apply(loaded(1), { type: "clear" });
    expect(titles(state)).toEqual(["a", "b"]);
    expect(currentTrack(state)?.id).toBe("local:b");
    expect(peekNext(state)).toBeNull();
  });

  it("keeps a shuffled queue's played tracks in the order they played", () => {
    const shuffled = apply(
      loaded(0),
      { type: "setShuffle", shuffle: true, rng: () => 0.5 },
      { type: "next", reason: "user" },
    );
    const played = titles(shuffled).slice(0, 2);
    const state = apply(shuffled, { type: "clear" }, { type: "setShuffle", shuffle: false });
    expect(titles(state)).toEqual(played);
    expect(currentTrack(state)?.id).toBe(`local:${played[1]}`);
  });

  it("empties a queue with nothing playing", () => {
    const state = apply(loaded(0), { type: "remove", trackId: "local:a" as TrackId });
    const idle = { ...state, cursor: null };
    expect(apply(idle, { type: "clear" }).items).toEqual([]);
  });

  it("shuffles without interrupting the current track", () => {
    const rng = () => 0.5;
    const state = apply(loaded(2), { type: "setShuffle", shuffle: true, rng });
    expect(currentTrack(state)?.id).toBe("local:c");
    expect(state.order).toHaveLength(4);
    expect([...state.order].sort()).toEqual([0, 1, 2, 3]);
  });

  it("restores the original order when shuffle is turned off", () => {
    const state = apply(
      loaded(2),
      { type: "setShuffle", shuffle: true, rng: () => 0.5 },
      { type: "setShuffle", shuffle: false },
    );
    expect(titles(state)).toEqual(["a", "b", "c", "d"]);
    expect(currentTrack(state)?.id).toBe("local:c");
  });

  it("reports the next track for prefetching", () => {
    expect(peekNext(loaded(0))?.id).toBe("local:b");
    expect(peekNext(loaded(3))).toBeNull();
  });

  it("reports the same track for prefetching under repeat one", () => {
    const state = apply(loaded(0), { type: "setRepeat", repeat: "one" });
    expect(peekNext(state)?.id).toBe("local:a");
  });

  it("extends the queue in order when shuffle is off", () => {
    const state = apply(loaded(1), { type: "extend", tracks: [track("e"), track("f")] });
    expect(titles(state)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(currentTrack(state)?.id).toBe("local:b");
  });

  it("shuffles extensions in among the tracks still to come", () => {
    const shuffled = apply(loaded(0), { type: "setShuffle", shuffle: true, rng: () => 0 });
    const state = apply(shuffled, {
      type: "extend",
      tracks: [track("e"), track("f")],
      rng: () => 0,
    });
    // rng 0 puts each at the first upcoming slot, never before the current track.
    expect(titles(state).slice(0, 3)).toEqual(["a", "f", "e"]);
    expect(currentTrack(state)?.id).toBe("local:a");
    expect(state.order).toHaveLength(6);
  });

  it("plays suggestions once the queue runs out", () => {
    const withSuggestions = apply(loaded(3), {
      type: "setSuggestions",
      tracks: [track("x"), track("y")],
    });
    expect(peekNext(withSuggestions)?.id).toBe("local:x");
    const state = apply(withSuggestions, { type: "next", reason: "trackEnded" });
    expect(currentTrack(state)?.id).toBe("local:x");
    expect(titles(state)).toEqual(["a", "b", "c", "d", "x"]);
    expect(state.suggestions.map((t) => t.id)).toEqual(["local:y"]);
  });

  it("leaves suggestions alone while repeat is on", () => {
    const state = apply(
      loaded(3),
      { type: "setSuggestions", tracks: [track("x")] },
      { type: "setRepeat", repeat: "all" },
      { type: "next", reason: "trackEnded" },
    );
    expect(currentTrack(state)?.id).toBe("local:a");
  });

  it("jumps to a suggestion, passing over the ones above it", () => {
    const state = apply(
      loaded(0),
      { type: "setSuggestions", tracks: [track("x"), track("y"), track("z")] },
      { type: "jumpTo", trackId: "local:y" as TrackId },
    );
    expect(currentTrack(state)?.id).toBe("local:y");
    expect(state.suggestions.map((t) => t.id)).toEqual(["local:z"]);
  });

  it("leaves out suggestions that are already queued", () => {
    const state = apply(loaded(0), { type: "setSuggestions", tracks: [track("b"), track("x")] });
    expect(state.suggestions.map((t) => t.id)).toEqual(["local:x"]);
  });

  it("drops suggestions when a new queue is set", () => {
    const state = apply(
      loaded(0),
      { type: "setSuggestions", tracks: [track("x")] },
      { type: "setQueue", tracks, startIndex: 0 },
    );
    expect(state.suggestions).toEqual([]);
  });
});

describe("restoring a saved queue", () => {
  const saved = {
    items: tracks,
    order: [2, 0, 3, 1],
    cursor: 1,
    repeat: "all" as const,
    shuffle: true,
  };

  it("comes back with its order, song, shuffle and repeat", () => {
    const state = queueReducer(emptyQueue, { type: "restore", queue: saved });
    expect(titles(state)).toEqual(["c", "a", "d", "b"]);
    expect(currentTrack(state)?.id).toBe("local:a");
    expect(state.shuffle).toBe(true);
    expect(state.repeat).toBe("all");
    // Turning shuffle off still finds the song in the order it was added.
    const unshuffled = queueReducer(state, { type: "setShuffle", shuffle: false });
    expect(titles(unshuffled)).toEqual(["a", "b", "c", "d"]);
    expect(currentTrack(unshuffled)?.id).toBe("local:a");
  });

  it("is ignored when it does not hold together", () => {
    for (const broken of [
      { ...saved, cursor: null },
      { ...saved, cursor: 4 },
      { ...saved, order: [0, 1, 2] },
      { ...saved, order: [0, 0, 1, 2] },
      { ...saved, order: [0, 1, 2, 7] },
      { ...saved, items: [], order: [], cursor: 0 },
    ]) {
      expect(queueReducer(emptyQueue, { type: "restore", queue: broken })).toBe(emptyQueue);
    }
  });
});

/** mulberry32: a small seeded generator, so weighted orders are repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("fewer repeats", () => {
  const NOW = Date.UTC(2026, 9, 29);
  const ten = "abcdefghij".split("").map(track);
  // "b" played a minute ago, "c" a week ago, the rest never.
  const history = { "local:b": NOW - 60_000, "local:c": NOW - 7 * 24 * 3600_000 };
  const weight = playHistoryWeight(history, NOW);
  const RUNS = 2000;

  /** Mean position of each track over many seeded shuffles. */
  function meanPositions(shuffle: (rng: () => number) => QueueState): Map<string, number> {
    const sums = new Map<string, number>();
    for (let seed = 1; seed <= RUNS; seed++) {
      titles(shuffle(seeded(seed))).forEach((id, at) => sums.set(id, (sums.get(id) ?? 0) + at));
    }
    return new Map([...sums].map(([id, sum]) => [id, sum / RUNS]));
  }

  it("weighs a track by how long ago it played", () => {
    expect(recencyWeight(undefined, NOW)).toBe(1);
    expect(recencyWeight(NOW, NOW)).toBeCloseTo(0.05);
    expect(recencyWeight(NOW - 7 * 24 * 3600_000, NOW)).toBeCloseTo(0.65, 2);
    expect(recencyWeight(NOW - 30 * 24 * 3600_000, NOW)).toBeGreaterThan(0.98);
  });

  it("puts recently played tracks later when shuffle goes on, keeping the current one first", () => {
    const start = queueReducer(emptyQueue, { type: "setQueue", tracks: ten, startIndex: 0 });
    const means = meanPositions((rng) =>
      queueReducer(start, { type: "setShuffle", shuffle: true, rng, weight }),
    );
    expect(means.get("a")).toBe(0);
    const never = ["d", "e", "f", "g", "h", "i", "j"].map((id) => means.get(id)!);
    const neverMean = never.reduce((a, b) => a + b) / never.length;
    expect(means.get("b")!).toBeGreaterThan(8);
    expect(means.get("c")!).toBeGreaterThan(neverMean);
    expect(means.get("c")!).toBeLessThan(means.get("b")!);
  });

  it("stays random rather than sorting", () => {
    const start = queueReducer(emptyQueue, { type: "setQueue", tracks: ten, startIndex: 0 });
    const orders = new Set<string>();
    const lastOf = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const ids = titles(
        queueReducer(start, { type: "setShuffle", shuffle: true, rng: seeded(seed), weight }),
      );
      orders.add(ids.join(""));
      lastOf.add(ids.at(-1)!);
    }
    expect(orders.size).toBeGreaterThan(150);
    expect(lastOf.size).toBeGreaterThan(1);
  });

  it("weights a shuffled new queue the same way, starting at the picked track", () => {
    const shuffleOn = { ...emptyQueue, shuffle: true };
    const means = meanPositions((rng) =>
      queueReducer(shuffleOn, { type: "setQueue", tracks: ten, startIndex: 4, rng, weight }),
    );
    expect(means.get("e")).toBe(0);
    expect(means.get("b")!).toBeGreaterThan(8);
  });

  it("puts recently played tracks later when they arrive after the queue started", () => {
    const shuffleOn = { ...emptyQueue, shuffle: true };
    const firstPage = ten.slice(0, 5);
    const secondPage = ten.slice(5).concat(track("z"));
    const zHistory = { ...history, "local:z": NOW - 60_000 };
    const zWeight = playHistoryWeight(zHistory, NOW);
    let zSum = 0;
    let otherSum = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const rng = seeded(seed);
      const before = apply(
        shuffleOn,
        { type: "setQueue", tracks: firstPage, startIndex: 0, rng, weight: zWeight },
        { type: "next", reason: "user" },
      );
      const after = queueReducer(before, {
        type: "extend",
        tracks: secondPage,
        rng,
        weight: zWeight,
      });
      // What was already there keeps its order, and nothing lands before the cursor.
      expect(titles(after).filter((id) => firstPage.some((t) => t.id === `local:${id}`))).toEqual(
        titles(before),
      );
      expect(after.order.slice(0, 2)).toEqual(before.order.slice(0, 2));
      const ids = titles(after);
      zSum += ids.indexOf("z");
      otherSum += ["f", "g", "h", "i", "j"].reduce((sum, id) => sum + ids.indexOf(id), 0) / 5;
    }
    expect(zSum / RUNS).toBeGreaterThan(otherSum / RUNS + 2);
  });

  it("splices with equal weights into a uniformly random slot", () => {
    const shuffleOn = { ...emptyQueue, shuffle: true };
    const counts = [0, 0, 0, 0, 0];
    for (let seed = 1; seed <= RUNS; seed++) {
      const rng = seeded(seed);
      const before = queueReducer(shuffleOn, {
        type: "setQueue",
        tracks: tracks,
        startIndex: 0,
        rng,
        weight: () => 1,
      });
      const after = queueReducer(before, { type: "extend", tracks: [track("z")], rng, weight: () => 1 });
      counts[titles(after).indexOf("z")]! += 1;
    }
    expect(counts[0]).toBe(0);
    for (const count of counts.slice(1)) expect(count / RUNS).toBeCloseTo(0.25, 1);
  });

  it("keeps the play history bounded", () => {
    expect(recordPlay({ "local:old": NOW - PLAY_HISTORY_MAX_AGE_MS }, "local:a", NOW)).toEqual({
      "local:a": NOW,
    });
    const full = Object.fromEntries(
      Array.from({ length: PLAY_HISTORY_MAX_ENTRIES }, (_, i) => [`local:${i}`, NOW - 1000 - i]),
    );
    const bounded = recordPlay(full, "local:a", NOW);
    expect(Object.keys(bounded)).toHaveLength(PLAY_HISTORY_MAX_ENTRIES);
    expect(bounded["local:a"]).toBe(NOW);
    // The oldest goes to make room.
    expect(bounded[`local:${PLAY_HISTORY_MAX_ENTRIES - 1}`]).toBeUndefined();
  });
});
