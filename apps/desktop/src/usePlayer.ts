import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  currentTrack,
  emptyQueue,
  sourceOf,
  isLeaseUsable,
  type QueueAction,
  queueReducer,
  type RepeatMode,
  type StreamLease,
  type Track,
  type TrackId,
} from "@ytbm/core";
import { resolveTrack } from "./resolve.ts";
import { usePlayback } from "./usePlayback.ts";

/** A transport failure that has no user-visible consequence beyond not happening. */
function logPlaybackFailure(error: unknown): void {
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
  const { state, engine, load, reportError } = usePlayback();
  /**
   * The slider position in 0..1. Held here rather than in the player bar
   * because the OS can set it too, from the MPRIS volume control.
   */
  const [volume, setVolumeState] = useState(1);

  const track = currentTrack(queue);
  const trackId = track?.id ?? null;

  /**
   * Which track we last asked mpv to load. Without it, any re-render that
   * produces the same current track would reload and restart it.
   */
  const loadedId = useRef<TrackId | null>(null);
  const leases = useRef(new Map<TrackId, StreamLease>());
  /** The track already given its fallback retry, so a second failure sticks. */
  const retried = useRef<TrackId | null>(null);

  useEffect(() => {
    if (trackId === null) {
      // Only stop if something was actually playing. Stopping an idle player
      // is both pointless and, outside the Tauri webview, an error.
      if (loadedId.current !== null) {
        loadedId.current = null;
        void engine.stop().catch(logPlaybackFailure);
      }
      return;
    }
    if (loadedId.current === trackId) return;
    loadedId.current = trackId;
    retried.current = null;

    let cancelled = false;
    void (async () => {
      const cached = leases.current.get(trackId);
      const lease =
        cached && isLeaseUsable(cached, Date.now()) ? cached : await resolveTrack(trackId);
      // The user can skip while a lease is in flight; dropping the result is
      // correct, because a newer effect is already resolving the new track.
      if (cancelled) return;
      leases.current.set(trackId, lease);
      await load(lease);
      await engine.play();
    })().catch((error: unknown) => {
      logPlaybackFailure(error);
      // Resolution happens before mpv is involved, so its failures have no
      // event stream to arrive on. Put them where the player's errors go.
      if (!cancelled) reportError(error instanceof Error ? error.message : String(error));
    });

    return () => {
      cancelled = true;
    };
  }, [trackId, engine, load, reportError]);

  // A YouTube stream can resolve fine and still be refused once mpv asks for
  // it — a 403 surfaces only here. Retry such a track once on the PO-token
  // client before letting the error stand.
  useEffect(
    () =>
      engine.subscribe((event) => {
        if (event.type !== "error") return;
        const failed = event.trackId;
        if (failed === null || failed !== loadedId.current) return;
        if (sourceOf(failed) !== "youtube" || retried.current === failed) return;
        retried.current = failed;
        leases.current.delete(failed);
        void (async () => {
          const lease = await resolveTrack(failed, { fallback: true });
          if (loadedId.current !== failed) return;
          leases.current.set(failed, lease);
          await load(lease);
          await engine.play();
        })().catch((error: unknown) => {
          logPlaybackFailure(error);
          if (loadedId.current === failed) {
            reportError(error instanceof Error ? error.message : String(error));
          }
        });
      }),
    [engine, load, reportError],
  );

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

  const play = useCallback(() => void engine.play().catch(logPlaybackFailure), [engine]);
  const pause = useCallback(() => void engine.pause().catch(logPlaybackFailure), [engine]);

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
  const setVolume = useCallback(
    (position: number) => {
      const clamped = Math.min(1, Math.max(0, position));
      setVolumeState(clamped);
      void engine.setVolume(clamped).catch(logPlaybackFailure);
    },
    [engine],
  );
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
    volume,
    playTrack,
    play,
    pause,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    setRepeat,
    setShuffle,
  };
}
