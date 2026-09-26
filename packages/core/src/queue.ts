import type { Track, TrackId } from "./domain.ts";

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
  /**
   * Autoplay: what YouTube Music suggests after the queue. Kept apart from
   * `items` so shuffle and repeat never touch it; a suggestion joins the queue
   * only once it starts playing.
   */
  readonly suggestions: readonly Track[];
}

export const emptyQueue: QueueState = {
  items: [],
  order: [],
  cursor: null,
  repeat: "off",
  shuffle: false,
  suggestions: [],
};

export type QueueAction =
  | { type: "setQueue"; tracks: readonly Track[]; startIndex?: number }
  | { type: "jumpTo"; trackId: TrackId }
  | { type: "next"; reason: "user" | "trackEnded" }
  | { type: "previous" }
  | { type: "enqueueNext"; tracks: readonly Track[] }
  | { type: "enqueueLast"; tracks: readonly Track[] }
  /**
   * More of what is already queued, such as the rest of a playlist that is
   * still loading. Shuffled in among the tracks still to come when shuffle is on.
   */
  | { type: "extend"; tracks: readonly Track[]; rng?: () => number }
  | { type: "setSuggestions"; tracks: readonly Track[] }
  | { type: "remove"; trackId: TrackId }
  /**
   * Drags the track at playing position `from` so it ends up at position `to`.
   * The playing track keeps playing wherever it lands.
   */
  | { type: "move"; from: number; to: number }
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
        return { ...state, items: [], order: [], cursor: null, suggestions: [] };
      }
      const order = state.shuffle
        ? shuffledOrderStartingAt(identity, startIndex, Math.random)
        : identity;
      const cursor = order.indexOf(startIndex);
      return { ...state, items, order, cursor, suggestions: [] };
    }

    case "jumpTo": {
      const itemIndex = state.items.findIndex((t) => t.id === action.trackId);
      if (itemIndex === -1) {
        // Picking a suggestion plays it now; the ones above it are passed over.
        const suggested = state.suggestions.findIndex((t) => t.id === action.trackId);
        return suggested === -1 ? state : promote(state, suggested);
      }
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
      if (state.suggestions.length > 0) return promote(state, 0);
      return action.reason === "trackEnded" ? { ...state, cursor: null } : state;
    }

    case "previous": {
      if (state.cursor === null) return state;
      if (state.cursor > 0) return { ...state, cursor: state.cursor - 1 };
      return state.repeat === "all" ? { ...state, cursor: state.order.length - 1 } : state;
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

    case "extend": {
      if (action.tracks.length === 0) return state;
      const items = [...state.items, ...action.tracks];
      const newIndices = action.tracks.map((_, i) => state.items.length + i);
      if (!state.shuffle) return { ...state, items, order: [...state.order, ...newIndices] };
      // Each new track lands at a uniformly random place among those still to
      // come, which keeps the upcoming order a uniform shuffle.
      const rng = action.rng ?? Math.random;
      const order = [...state.order];
      const start = state.cursor === null ? 0 : state.cursor + 1;
      for (const index of newIndices) {
        const at = start + Math.floor(rng() * (order.length - start + 1));
        order.splice(at, 0, index);
      }
      return { ...state, items, order };
    }

    case "setSuggestions": {
      // A suggestion already queued would play twice.
      const queued = new Set(state.items.map((t) => t.id));
      return { ...state, suggestions: action.tracks.filter((t) => !queued.has(t.id)) };
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

    case "move": {
      const { from, to } = action;
      const length = state.order.length;
      if (from === to || from < 0 || to < 0 || from >= length || to >= length) return state;
      const order = [...state.order];
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved!);
      let cursor = state.cursor;
      if (cursor !== null) {
        if (cursor === from) cursor = to;
        else if (from < cursor && cursor <= to) cursor -= 1;
        else if (to <= cursor && cursor < from) cursor += 1;
      }
      if (state.shuffle) return { ...state, order, cursor };
      // Unshuffled, the order the user arranged is the one to keep, including
      // once shuffle goes on and off again, so `items` takes it on.
      return {
        ...state,
        items: order.map((i) => state.items[i]!),
        order: order.map((_, i) => i),
        cursor,
      };
    }

    case "clear":
      return { ...state, items: [], order: [], cursor: null, suggestions: [] };

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
      const order = shuffledOrderStartingAt(identity, currentItem ?? 0, action.rng ?? Math.random);
      return {
        ...state,
        shuffle: true,
        order,
        cursor: currentItem === null ? state.cursor : 0,
      };
    }
  }
}

/** Moves suggestion `index` onto the end of the queue and plays it, dropping those before it. */
function promote(state: QueueState, index: number): QueueState {
  const track = state.suggestions[index];
  if (!track) return state;
  const items = [...state.items, track];
  const order = [...state.order, items.length - 1];
  return {
    ...state,
    items,
    order,
    cursor: order.length - 1,
    suggestions: state.suggestions.slice(index + 1),
  };
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
  if (index === undefined) return state.suggestions[0] ?? null;
  return state.items[index] ?? null;
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
