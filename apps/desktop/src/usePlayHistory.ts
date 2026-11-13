import {
  type PlaybackStatus,
  type PlayHistory,
  playHistoryWeight,
  recordPlay,
  type TrackId,
  type TrackWeight,
} from "@ymusic/core";
import { playHistoryLoad, playHistorySave } from "@ymusic/ipc";
import { useCallback, useEffect, useRef } from "react";

function logFailure(error: unknown): void {
  console.error("could not save the play history", error);
}

/**
 * When each track last played on this device, for fewer repeats. A track
 * counts once it is playing, not when it is queued or loading. Kept apart
 * from the account's watch history, so it records under "Pause watch
 * history" too: it never leaves the device.
 *
 * Returns a weighting for the queue as of the moment it is called.
 */
export function usePlayHistory(trackId: TrackId | null, status: PlaybackStatus): () => TrackWeight {
  const history = useRef<PlayHistory>({});
  /** Whether the saved history has been read. Plays before that are merged into it. */
  const loaded = useRef(false);
  const recorded = useRef<TrackId | null>(null);

  useEffect(() => {
    let cancelled = false;
    void playHistoryLoad()
      .then((saved) => {
        if (cancelled) return;
        const merged = { ...saved };
        for (const [id, at] of Object.entries(history.current)) {
          merged[id] = Math.max(at, merged[id] ?? 0);
        }
        history.current = merged;
        loaded.current = true;
      })
      .catch((error: unknown) => console.error("could not read the play history", error));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (trackId === null || status !== "playing" || recorded.current === trackId) return;
    recorded.current = trackId;
    history.current = recordPlay(history.current, trackId, Date.now());
    // Saving before the file is read would write over it.
    if (loaded.current) void playHistorySave(history.current).catch(logFailure);
  }, [trackId, status]);

  return useCallback(() => playHistoryWeight(history.current, Date.now()), []);
}
