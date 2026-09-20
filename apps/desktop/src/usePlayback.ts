import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlaybackStatus, StreamLease } from "@ytbm/core";
import { MpvPlaybackEngine } from "@ytbm/ipc";

export interface PlaybackState {
  status: PlaybackStatus;
  positionMs: number;
  durationMs: number | null;
  error: string | null;
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
    positionMs: 0,
    durationMs: null,
    error: null,
  });
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(
    () =>
      engine.subscribe((event) => {
        setState((previous) => {
          switch (event.type) {
            case "status":
              return { ...previous, status: event.status };
            case "position":
              return {
                ...previous,
                positionMs: event.positionMs,
                durationMs: event.durationMs ?? previous.durationMs,
              };
            case "ended":
              return { ...previous, status: "ended", positionMs: 0 };
            case "error":
              return { ...previous, status: "idle", error: event.message };
          }
        });
      }),
    [engine],
  );

  const load = useCallback(
    async (lease: StreamLease) => {
      setState({ status: "loading", positionMs: 0, durationMs: null, error: null });
      try {
        await engineRef.current.load(lease);
      } catch (error) {
        setState((previous) => ({ ...previous, status: "idle", error: String(error) }));
      }
    },
    [],
  );

  return { state, engine, load };
}
