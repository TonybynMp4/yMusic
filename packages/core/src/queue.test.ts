import { describe, expect, it } from "vitest";
import type { Track, TrackId } from "./domain.ts";
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
  durationMs: 180_000,
  thumbnails: [],
  isExplicit: false,
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
    expect(currentTrack(apply(repeating, { type: "next", reason: "trackEnded" }))?.id).toBe("local:b");
    expect(currentTrack(apply(repeating, { type: "next", reason: "user" }))?.id).toBe("local:c");
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
});
