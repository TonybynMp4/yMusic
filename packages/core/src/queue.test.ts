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
  albumId: null,
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
