import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PlaybackStatus, StreamLease } from "@ytbm/core";
import { MpvPlaybackEngine } from "@ytbm/ipc";

export interface PlaybackState {
  status: PlaybackStatus;
  durationMs: number | null;
  error: string | null;
}

/**
 * The playback position, kept out of React state. mpv reports it several
 * times a second, and as state it re-rendered the whole app on every tick,
 * a two-thousand-row playlist included. Only what shows the position
 * subscribes to it, through `usePosition`.
 */
export interface PositionStore {
  get(): number;
  subscribe(listener: () => void): () => void;
}

function createPositionStore(): PositionStore & { set(positionMs: number): void } {
  let position = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => position,
    set(next) {
      if (next === position) return;
      position = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export function usePosition(store: PositionStore): number {
  return useSyncExternalStore(store.subscribe, store.get);
}

/**
 * Subscribes to the Rust player once and exposes its transport. The engine is
 * held behind the `PlaybackEngine` interface so swapping libmpv for a platform
 * player on mobile costs nothing above this hook.
 */
export function usePlayback() {
  const engine = useMemo(() => new MpvPlaybackEngine(), []);
  const [state, setState] = useState<PlaybackState>({
    status: "idle",
    durationMs: null,
    error: null,
  });
  const position = useMemo(createPositionStore, []);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(
    () =>
      engine.subscribe((event) => {
        if (event.type === "position") position.set(event.positionMs);
        if (event.type === "ended") position.set(0);
        setState((previous) => {
          switch (event.type) {
            case "status":
              return previous.status === event.status ? previous : { ...previous, status: event.status };
            case "position": {
              // Unchanged state is returned as is, so React skips the render.
              const durationMs = event.durationMs ?? previous.durationMs;
              return durationMs === previous.durationMs ? previous : { ...previous, durationMs };
            }
            case "ended":
              return { ...previous, status: "ended" };
            case "error":
              return { ...previous, status: "idle", error: event.message };
          }
        });
      }),
    [engine, position],
  );

  const load = useCallback(
    async (lease: StreamLease) => {
      position.set(0);
      setState({ status: "loading", durationMs: null, error: null });
      try {
        await engineRef.current.load(lease);
      } catch (error) {
        setState((previous) => ({ ...previous, status: "idle", error: String(error) }));
      }
    },
    [position],
  );

  /**
   * Reports a failure that never reached mpv, such as a lease that could not be
   * resolved, say. Without this those failures are only a console line, and
   * the UI just sits there having silently not played anything.
   */
  const reportError = useCallback((message: string) => {
    setState((previous) => ({ ...previous, status: "idle", error: message }));
  }, []);

  return { state, position, engine, load, reportError };
}
