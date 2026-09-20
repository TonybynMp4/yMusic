import type { Track, VideoId } from "./domain.ts";

export type RepeatMode = "off" | "all" | "one";

export interface QueueState {
  /** Tracks in the order the user added them. Shuffle never mutates this. */
  readonly items: readonly Track[];
  /**
   * Playback order as indices into `items`. Identity when unshuffled, a
   * permutation when shuffled, which is what lets shuffle be turned off
   * without losing where the user was.
   */
  readonly order: readonly number[];
  /** Position within `order`, not within `items`. Null when nothing is loaded. */
  readonly cursor: number | null;
  readonly repeat: RepeatMode;
  readonly shuffle: boolean;
}

export const emptyQueue: QueueState = {
  items: [],
  order: [],
  cursor: null,
  repeat: "off",
  shuffle: false,
};

export type QueueAction =
  | { type: "setQueue"; tracks: readonly Track[]; startIndex?: number }
  | { type: "jumpTo"; trackId: VideoId }
  | { type: "next"; reason: "user" | "trackEnded" }
  | { type: "previous" }
  | { type: "enqueueNext"; tracks: readonly Track[] }
  | { type: "enqueueLast"; tracks: readonly Track[] }
  | { type: "remove"; trackId: VideoId }
  | { type: "clear" }
  | { type: "setRepeat"; repeat: RepeatMode }
  | { type: "setShuffle"; shuffle: boolean; rng?: () => number };

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "setQueue": {
      const items = [...action.tracks];
      const identity = items.map((_, i) => i);
      const startIndex = action.startIndex ?? 0;
      if (items.length === 0) {
        return { ...state, items: [], order: [], cursor: null };
      }
      const order = state.shuffle
        ? shuffledOrderStartingAt(identity, startIndex, Math.random)
        : identity;
      const cursor = order.indexOf(startIndex);
      return { ...state, items, order, cursor };
    }

    case "jumpTo": {
      const itemIndex = state.items.findIndex((t) => t.id === action.trackId);
      if (itemIndex === -1) return state;
      const cursor = state.order.indexOf(itemIndex);
      return cursor === -1 ? state : { ...state, cursor };
    }

    case "next": {
      if (state.cursor === null) return state;
      // Repeat-one holds the track only when it ran out on its own. An explicit
      // skip means the user wants a different song, not the same one again.
      if (state.repeat === "one" && action.reason === "trackEnded") return state;
      const nextCursor = state.cursor + 1;
      if (nextCursor < state.order.length) return { ...state, cursor: nextCursor };
      if (state.repeat === "all") return { ...state, cursor: 0 };
      return action.reason === "trackEnded" ? { ...state, cursor: null } : state;
    }

    case "previous": {
      if (state.cursor === null) return state;
      if (state.cursor > 0) return { ...state, cursor: state.cursor - 1 };
      return state.repeat === "all"
        ? { ...state, cursor: state.order.length - 1 }
        : state;
    }

    case "enqueueNext": {
      if (action.tracks.length === 0) return state;
      const items = [...state.items, ...action.tracks];
      const newIndices = action.tracks.map((_, i) => state.items.length + i);
      if (state.cursor === null) {
        return { ...state, items, order: [...state.order, ...newIndices], cursor: 0 };
      }
      const order = [
        ...state.order.slice(0, state.cursor + 1),
        ...newIndices,
        ...state.order.slice(state.cursor + 1),
      ];
      return { ...state, items, order };
    }

    case "enqueueLast": {
      if (action.tracks.length === 0) return state;
      const items = [...state.items, ...action.tracks];
      const newIndices = action.tracks.map((_, i) => state.items.length + i);
      const order = [...state.order, ...newIndices];
      return { ...state, items, order, cursor: state.cursor ?? 0 };
    }

    case "remove": {
      const itemIndex = state.items.findIndex((t) => t.id === action.trackId);
      if (itemIndex === -1) return state;
      const removedCursor = state.order.indexOf(itemIndex);
      const items = state.items.filter((_, i) => i !== itemIndex);
      // Indices above the hole shift down by one.
      const order = state.order
        .filter((i) => i !== itemIndex)
        .map((i) => (i > itemIndex ? i - 1 : i));
      let cursor = state.cursor;
      if (cursor !== null) {
        if (removedCursor < cursor) cursor -= 1;
        // Removing the playing track leaves the cursor pointing at whatever
        // slid into its place, which is the next track.
        if (cursor >= order.length) cursor = order.length === 0 ? null : order.length - 1;
      }
      return { ...state, items, order, cursor: items.length === 0 ? null : cursor };
    }

    case "clear":
      return { ...state, items: [], order: [], cursor: null };

    case "setRepeat":
      return { ...state, repeat: action.repeat };

    case "setShuffle": {
      if (action.shuffle === state.shuffle) return state;
      const identity = state.items.map((_, i) => i);
      if (!action.shuffle) {
        const currentItem = currentItemIndex(state);
        return {
          ...state,
          shuffle: false,
          order: identity,
          cursor: currentItem === null ? null : currentItem,
        };
      }
      const currentItem = currentItemIndex(state);
      const order = shuffledOrderStartingAt(
        identity,
        currentItem ?? 0,
        action.rng ?? Math.random,
      );
      return {
        ...state,
        shuffle: true,
        order,
        cursor: currentItem === null ? state.cursor : 0,
      };
    }
  }
}

/** The index into `items` of the track playing now. */
export function currentItemIndex(state: QueueState): number | null {
  if (state.cursor === null) return null;
  return state.order[state.cursor] ?? null;
}

export function currentTrack(state: QueueState): Track | null {
  const index = currentItemIndex(state);
  return index === null ? null : (state.items[index] ?? null);
}

/**
 * The track that will play next, or null at the end of the queue. Used to
 * pre-resolve the next stream lease so transitions stay gapless.
 */
export function peekNext(state: QueueState): Track | null {
  if (state.cursor === null) return null;
  if (state.repeat === "one") return currentTrack(state);
  const nextCursor = state.cursor + 1;
  const index =
    nextCursor < state.order.length
      ? state.order[nextCursor]
      : state.repeat === "all"
        ? state.order[0]
        : undefined;
  return index === undefined ? null : (state.items[index] ?? null);
}

/**
 * Fisher-Yates over everything except the current track, which is moved to the
 * front so enabling shuffle never interrupts what is already playing.
 */
function shuffledOrderStartingAt(
  indices: readonly number[],
  first: number,
  rng: () => number,
): number[] {
  const rest = indices.filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = rest[i]!;
    rest[i] = rest[j]!;
    rest[j] = a;
  }
  return indices.includes(first) ? [first, ...rest] : rest;
}
