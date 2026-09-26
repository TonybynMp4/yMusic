import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  currentTrack,
  emptyQueue,
  sourceOf,
  isLeaseUsable,
  peekNext,
  type QueueAction,
  queueReducer,
  type RepeatMode,
  type StreamLease,
  type Track,
  type QueueState,
  type TrackId,
  videoIdFromTrackId,
} from "@ymusic/core";
import { engine as youtube } from "./engine.ts";
import { resolveTrack } from "./resolve.ts";
import { followPlaylist } from "./useBrowse.ts";
import { usePlayback } from "./usePlayback.ts";

/** A transport failure that has no user-visible consequence beyond not happening. */
function logPlaybackFailure(error: unknown): void {
  console.error("playback command failed", error);
}

/**
 * Where a queue came from, so it can keep growing: a playlist still loading
 * its later pages, or a song radio (what YouTube Music starts when you play a
 * search result).
 */
export type PlayFrom = { kind: "playlist"; id: string } | { kind: "radio" };

/**
 * The seed for autoplay: the last YouTube track in playing order. Local files
 * have no radio, so a queue of only those gets no suggestions.
 */
function radioSeed(queue: QueueState): TrackId | null {
  for (let i = queue.order.length - 1; i >= 0; i--) {
    const track = queue.items[queue.order[i]!];
    if (track && sourceOf(track.id) === "youtube") return track.id;
  }
  return null;
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
  const { state, position, engine, load, reportError } = usePlayback();
  /**
   * The slider position in 0..1. Held here rather than in the player bar
   * because the OS can set it too, from the MPRIS volume control.
   */
  const [volume, setVolumeState] = useState(1);
  /** On, as in YouTube Music: when the queue runs out, its suggestions play on. */
  const [autoplay, setAutoplayState] = useState(true);
  /** The queue's source is still arriving, so autoplay waits for its real end. */
  const [filling, setFilling] = useState(false);
  /** Stops following the current source. Replaced on every new queue. */
  const unfollow = useRef<() => void>(() => {});

  const track = currentTrack(queue);
  const trackId = track?.id ?? null;

  /**
   * Which track we last asked mpv to load. Without it, any re-render that
   * produces the same current track would reload and restart it.
   */
  const loadedId = useRef<TrackId | null>(null);
  const leases = useRef(new Map<TrackId, StreamLease>());
  /** Resolutions in flight, so the load and the pre-resolve share one request. */
  const resolving = useRef(new Map<TrackId, Promise<StreamLease>>());
  /** The track already given its fallback retry, so a second failure sticks. */
  const retried = useRef<TrackId | null>(null);

  /** A cached lease while it is still usable, otherwise a fresh one. */
  const leaseFor = useCallback((id: TrackId): Promise<StreamLease> => {
    const cached = leases.current.get(id);
    if (cached && isLeaseUsable(cached, Date.now())) return Promise.resolve(cached);
    const pending = resolving.current.get(id);
    if (pending) return pending;
    const request = resolveTrack(id)
      .then((lease) => {
        leases.current.set(id, lease);
        return lease;
      })
      .finally(() => resolving.current.delete(id));
    resolving.current.set(id, request);
    return request;
  }, []);

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
      const lease = await leaseFor(trackId);
      // The user can skip while a lease is in flight; dropping the result is
      // correct, because a newer effect is already resolving the new track.
      if (cancelled) return;
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
  }, [trackId, engine, load, reportError, leaseFor]);

  // Resolve the next YouTube track while this one plays, so the change of
  // track doesn't wait on YouTube. Only once playing, so it never competes
  // with resolving the track the user is waiting for.
  const upcomingId = peekNext(queue)?.id ?? null;
  const playing = state.status === "playing";
  useEffect(() => {
    if (!playing || upcomingId === null || upcomingId === trackId) return;
    if (sourceOf(upcomingId) !== "youtube") return;
    void leaseFor(upcomingId).catch((error: unknown) =>
      console.error("could not resolve the next track ahead of time", error),
    );
  }, [playing, upcomingId, trackId, leaseFor]);

  // A YouTube stream can resolve fine and still be refused once mpv asks for
  // it, and a 403 surfaces only here. Retry such a track once on the PO-token
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

  const stopFollowing = useCallback(() => {
    unfollow.current();
    unfollow.current = () => {};
    setFilling(false);
  }, []);

  /** Clearing or replacing the queue also stops it growing from its old source. */
  const send = useCallback(
    (action: QueueAction) => {
      if (action.type === "setQueue" || action.type === "clear") stopFollowing();
      dispatch(action);
    },
    [stopFollowing],
  );

  const playTrack = useCallback(
    (tracks: Track[], id: TrackId, from?: PlayFrom) => {
      if (from?.kind === "radio") {
        const seed = tracks.find((t) => t.id === id);
        const videoId = seed ? videoIdFromTrackId(seed.id) : null;
        if (!seed || videoId === null) return;
        send({ type: "setQueue", tracks: [seed], startIndex: 0 });
        let stopped = false;
        unfollow.current = () => {
          stopped = true;
        };
        setFilling(true);
        void youtube
          .radio(videoId)
          .then((radio) => {
            if (!stopped) dispatch({ type: "extend", tracks: radio });
          })
          .catch((error: unknown) => console.error("could not start the song radio", error))
          .finally(() => {
            if (!stopped) setFilling(false);
          });
        return;
      }

      send({ type: "setQueue", tracks, startIndex: tracks.findIndex((t) => t.id === id) });
      if (from?.kind !== "playlist") return;
      // Whatever the page had when it was clicked is queued already; each
      // later page is added as it arrives, shuffled in if shuffle is on.
      let known = tracks.length;
      let done = false;
      let stop = () => {};
      const follow = (all: readonly Track[], loading: boolean) => {
        if (done) return;
        if (all.length > known) {
          dispatch({ type: "extend", tracks: all.slice(known) });
          known = all.length;
        }
        setFilling(loading);
        if (!loading) {
          done = true;
          stop();
        }
      };
      stop = followPlaylist(from.id, follow);
      // The first call is synchronous, before `stop` was assigned.
      if (done) stop();
      unfollow.current = () => {
        done = true;
        stop();
      };
    },
    [send],
  );

  // Autoplay: once the queue is complete, ask YouTube Music what would follow
  // its last song, and keep that ready to play when the queue runs out.
  const seed = radioSeed(queue);
  const wantsSuggestions =
    autoplay &&
    queue.repeat === "off" &&
    !filling &&
    queue.cursor !== null &&
    queue.suggestions.length === 0;
  /** The seed last asked about, so one empty answer is not asked for again and again. */
  const askedSeed = useRef<TrackId | null>(null);
  useEffect(() => {
    if (!wantsSuggestions || seed === null || askedSeed.current === seed) return;
    const videoId = videoIdFromTrackId(seed);
    if (videoId === null) return;
    askedSeed.current = seed;
    let cancelled = false;
    void youtube
      .radio(videoId)
      .then((radio) => {
        if (!cancelled) dispatch({ type: "setSuggestions", tracks: radio });
      })
      .catch((error: unknown) => {
        console.error("could not load autoplay suggestions", error);
        if (!cancelled) askedSeed.current = null;
      });
    return () => {
      cancelled = true;
      if (askedSeed.current === seed) askedSeed.current = null;
    };
  }, [wantsSuggestions, seed]);

  const setAutoplay = useCallback((on: boolean) => {
    setAutoplayState(on);
    if (!on) {
      askedSeed.current = null;
      dispatch({ type: "setSuggestions", tracks: [] });
    }
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
    if (position.get() > 3000) {
      void engine.seek(0);
      return;
    }
    dispatch({ type: "previous" });
  }, [engine, position]);

  const seek = useCallback((positionMs: number) => void engine.seek(positionMs), [engine]);
  const setVolume = useCallback(
    (position: number) => {
      const clamped = Math.min(1, Math.max(0, position));
      setVolumeState(clamped);
      void engine.setVolume(clamped).catch(logPlaybackFailure);
    },
    [engine],
  );
  const setRepeat = useCallback(
    (repeat: RepeatMode) => dispatch({ type: "setRepeat", repeat }),
    [],
  );
  const setShuffle = useCallback(
    (shuffle: boolean) => dispatch({ type: "setShuffle", shuffle }),
    [],
  );

  return {
    queue,
    dispatch: send as React.Dispatch<QueueAction>,
    filling,
    autoplay,
    setAutoplay,
    track,
    playback: state,
    position,
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
