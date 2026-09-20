import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  currentTrack,
  emptyQueue,
  isLeaseUsable,
  type QueueAction,
  queueReducer,
  type RepeatMode,
  type StreamLease,
  type Track,
  type TrackId,
} from "@ytbm/core";
import { libraryResolve } from "@ytbm/ipc";

import { usePlayback } from "./usePlayback.ts";

/**
 * A resolve or transport failure should not become an unhandled rejection.
 * The user-visible error already comes through the playback event stream, so
 * this only has to keep the console honest.
 */
function reportPlaybackFailure(error: unknown): void {
  console.error("playback command failed", error);
}

/**
 * Joins the pure queue reducer to the real player: whenever the queue's current
 * track changes, resolve it to a lease and hand that to mpv.
 *
 * Resolution is deliberately kept asynchronous even though a local file could
 * be turned into a path synchronously. Wiring YouTube in later then means
 * swapping the resolver, not restructuring playback around a step that suddenly
 * became slow and fallible.
 */
export function usePlayer() {
  const [queue, dispatch] = useReducer(queueReducer, emptyQueue);
  const { state, engine, load } = usePlayback();

  const track = currentTrack(queue);
  const trackId = track?.id ?? null;

  /**
   * Which track we last asked mpv to load. Without it, any re-render that
   * produces the same current track would reload and restart it.
   */
  const loadedId = useRef<TrackId | null>(null);
  const leases = useRef(new Map<TrackId, StreamLease>());

  useEffect(() => {
    if (trackId === null) {
      // Only stop if something was actually playing. Stopping an idle player
      // is both pointless and, outside the Tauri webview, an error.
      if (loadedId.current !== null) {
        loadedId.current = null;
        void engine.stop().catch(reportPlaybackFailure);
      }
      return;
    }
    if (loadedId.current === trackId) return;
    loadedId.current = trackId;

    let cancelled = false;
    void (async () => {
      const cached = leases.current.get(trackId);
      const lease =
        cached && isLeaseUsable(cached, Date.now()) ? cached : await libraryResolve(trackId);
      // The user can skip while a lease is in flight; dropping the result is
      // correct, because a newer effect is already resolving the new track.
      if (cancelled) return;
      leases.current.set(trackId, lease);
      await load(lease);
      await engine.play();
    })().catch(reportPlaybackFailure);

    return () => {
      cancelled = true;
    };
  }, [trackId, engine, load]);

  // Auto-advance. `trackEnded` rather than `user` so repeat-one holds here and
  // only here, which is the distinction the reducer encodes.
  useEffect(
    () =>
      engine.subscribe((event) => {
        if (event.type !== "ended") return;
        // Repeat-one returns the same id, so the load effect would skip it.
        loadedId.current = null;
        dispatch({ type: "next", reason: "trackEnded" });
      }),
    [engine],
  );

  const playTrack = useCallback((tracks: Track[], id: TrackId) => {
    dispatch({
      type: "setQueue",
      tracks,
      startIndex: tracks.findIndex((t) => t.id === id),
    });
  }, []);

  const toggle = useCallback(() => {
    void (state.status === "playing" ? engine.pause() : engine.play());
  }, [engine, state.status]);

  const next = useCallback(() => dispatch({ type: "next", reason: "user" }), []);

  /**
   * Restarting rather than going back is what every other player does once you
   * are a few seconds into a track, and it is what the hardware previous key
   * is usually meant to do.
   */
  const previous = useCallback(() => {
    if (state.positionMs > 3000) {
      void engine.seek(0);
      return;
    }
    dispatch({ type: "previous" });
  }, [engine, state.positionMs]);

  const seek = useCallback((positionMs: number) => void engine.seek(positionMs), [engine]);
  const setVolume = useCallback((volume: number) => void engine.setVolume(volume), [engine]);
  const setRepeat = useCallback((repeat: RepeatMode) => dispatch({ type: "setRepeat", repeat }), []);
  const setShuffle = useCallback(
    (shuffle: boolean) => dispatch({ type: "setShuffle", shuffle }),
    [],
  );

  return {
    queue,
    dispatch: dispatch as React.Dispatch<QueueAction>,
    track,
    playback: state,
    playTrack,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    setRepeat,
    setShuffle,
  };
}
