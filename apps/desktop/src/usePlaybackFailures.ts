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
  current.current = trackId;
  const title = useRef(player.track?.title ?? "");
  title.current = player.track?.title ?? "";
  const actions = useRef(player);
  actions.current = player;
  const shown = useRef<{ trackId: TrackId; snackbar: string } | null>(null);

  // A new failure is a new object, so this runs once per failure.
  useEffect(() => {
    if (failure === null || failure.trackId !== current.current) return;
    const action = failureAction(failure);
    const failed = failure.trackId;
    let skipped = false;
    // Skip and the snackbar running out both move on, but only once, and
    // only if the failed song is still the one up.
    const skip = () => {
      if (skipped || current.current !== failed) return;
      skipped = true;
      actions.current.next();
    };
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
      onClose: action === "skip" ? skip : undefined,
    });
    shown.current = { trackId: failed, snackbar };
  }, [failure]);

  useEffect(() => {
    if (shown.current === null || shown.current.trackId === trackId) return;
    closeSnackbar(shown.current.snackbar);
    shown.current = null;
  }, [trackId]);
}
