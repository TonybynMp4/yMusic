import { useEffect, useRef } from "react";
import type { TrackId } from "@ymusic/core";

import { closeSnackbar, SNACKBAR_MS, showSnackbar } from "@/lib/snackbar";
import { failureAction, failureMessage } from "./playbackFailure.ts";
import type { usePlayer } from "./usePlayer.ts";

/**
 * Shows each song that fails to play as a snackbar, with Retry or Skip. Its
 * Retry would be for a song no longer playing once the song changes, so the
 * snackbar goes with it.
 */
export function usePlaybackFailures(player: ReturnType<typeof usePlayer>) {
  const { failure } = player;
  const trackId = player.track?.id ?? null;
  /** The playing song as of the last render, for a snackbar's late callbacks. */
  const current = useRef<TrackId | null>(trackId);
  const title = useRef(player.track?.title ?? "");
  const actions = useRef(player);
  // Declared before the effects that read them, so they see this render's values.
  useEffect(() => {
    current.current = trackId;
    title.current = player.track?.title ?? "";
    actions.current = player;
  });
  const shown = useRef<{ trackId: TrackId; snackbar: string } | null>(null);

  // A new failure is a new object, so this runs once per failure.
  useEffect(() => {
    if (failure === null || failure.trackId !== current.current) return;
    const action = failureAction(failure);
    const failed = failure.trackId;
    // Skip and the timer running out both move on, but only once, and only
    // if the failed song is still the one up.
    const skip = () => {
      clearTimeout(timer);
      if (current.current !== failed) return;
      actions.current.next();
    };
    // The snackbar's own timer is not used for this: Base UI pauses it while
    // the window is unfocused, which is where a player usually is.
    const timer = action === "skip" ? setTimeout(skip, SNACKBAR_MS) : undefined;
    const snackbar = showSnackbar({
      message: failureMessage(failure.kind, title.current),
      urgent: true,
      action:
        action === "retry"
          ? { label: "Retry", onClick: () => actions.current.retry() }
          : action === "skip"
            ? { label: "Skip", onClick: skip }
            : undefined,
      // The song waits on it, so it goes as quickly as one with no action.
      timeout: action === "skip" ? SNACKBAR_MS : undefined,
    });
    shown.current = { trackId: failed, snackbar };
    return () => clearTimeout(timer);
  }, [failure]);

  useEffect(() => {
    if (shown.current === null || shown.current.trackId === trackId) return;
    closeSnackbar(shown.current.snackbar);
    shown.current = null;
  }, [trackId]);
}
