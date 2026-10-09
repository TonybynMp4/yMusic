import { useEffect } from "react";
import { queueSave, queueSavePosition } from "@ymusic/ipc";

import type { usePlayer } from "./usePlayer.ts";

/** Long enough that a playlist arriving page by page is written once. */
const QUEUE_DEBOUNCE_MS = 500;
/** While playing. Rust saves the position on exit too, so this covers a crash. */
const POSITION_EVERY_MS = 10_000;

function logSaveFailure(error: unknown): void {
  console.error("could not save the queue", error);
}

/**
 * Saves the queue, the song in it and the position whenever they change, for
 * `useResume` to bring back at the next launch. Off until `enabled`, which
 * is once the launch has decided what to bring back.
 */
export function useSavedQueue(player: ReturnType<typeof usePlayer>, enabled: boolean): void {
  const { queue, shared, sourcePlaylist, position, loadedTrack, track } = player;
  const { items, order, cursor, repeat, shuffle } = queue;

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      // A queue that has run out has nothing to come back to.
      const saved =
        cursor === null
          ? null
          : { items, order, cursor, repeat, shuffle, playlistId: sourcePlaylist(), shared };
      void queueSave(saved).catch(logSaveFailure);
    }, QUEUE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, items, order, cursor, repeat, shuffle, shared, sourcePlaylist]);

  const trackId = track?.id ?? null;
  const status = player.playback.status;
  useEffect(() => {
    if (!enabled || trackId === null) return;
    const save = () => {
      // Until mpv has the song, the position and status are still the last one's.
      if (loadedTrack() !== trackId) return;
      const positionMs = Math.round(position.get());
      // Nothing worth keeping, and before a restored song has loaded, its
      // saved position would be lost to the 0 the player starts from.
      if (positionMs === 0) return;
      void queueSavePosition({ trackId, positionMs }).catch(logSaveFailure);
    };
    if (status === "paused") {
      save();
      return;
    }
    if (status !== "playing") return;
    const timer = setInterval(save, POSITION_EVERY_MS);
    return () => clearInterval(timer);
  }, [enabled, trackId, status, position, loadedTrack]);
}
