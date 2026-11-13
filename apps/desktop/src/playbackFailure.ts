import type { TrackId } from "@ymusic/core";

/**
 * What kind of failure stopped a song, which decides its copy and whether
 * trying again can help.
 *
 * - `missing`: a local file that is no longer on disk, or no longer in the library.
 * - `unavailable`: YouTube says the video is gone (status `ERROR`), the one
 *   answer the engine stops on without trying another player client.
 * - `offline`: a request never reached YouTube.
 * - `failed`: anything else, such as a stream mpv refused or no client serving it.
 */
export type FailureKind = "missing" | "unavailable" | "offline" | "failed";

export interface PlaybackFailure {
  trackId: TrackId;
  kind: FailureKind;
  /** Whether moving on would land on another song. */
  canSkip: boolean;
}

/**
 * Reads a failure from its raw message. Rust's errors arrive as plain strings
 * and the engine's through Comlink, so the text is all there is to go on.
 */
export function classifyFailure(message: string, online = true): FailureKind {
  if (/is no longer on disk|no track in the library with id/.test(message)) return "missing";
  // `NotPlayableError` puts YouTube's status first: `ERROR: <reason>`.
  if (/^(NotPlayableError: )?ERROR(:|$)/.test(message)) return "unavailable";
  if (
    !online ||
    /error sending request|failed to fetch|fetch failed|dns error|failed to lookup address|network is unreachable/i.test(
      message,
    )
  ) {
    return "offline";
  }
  return "failed";
}

/** Whether a failure is for good, so the queue moves on instead of offering Retry. */
export function isForGood(kind: FailureKind): boolean {
  return kind === "missing" || kind === "unavailable";
}

/**
 * The snackbar's one action. A failure trying again can fix gets Retry and
 * the song stays: a lost connection should not run through the queue. One
 * for good gets Skip, and the queue moves on by itself when the snackbar
 * goes, unless there is nowhere to move on to.
 */
export function failureAction(
  failure: Pick<PlaybackFailure, "kind" | "canSkip">,
): "retry" | "skip" | null {
  if (!isForGood(failure.kind)) return "retry";
  return failure.canSkip ? "skip" : null;
}

/** The snackbar's copy for a failure. Plain, with the raw error left to the log. */
export function failureMessage(kind: FailureKind, title: string): string {
  switch (kind) {
    case "missing":
      return `Couldn't find the file for ${title}`;
    case "unavailable":
      return `${title} isn't available on YouTube Music`;
    case "offline":
      return `Couldn't play ${title}. Check your connection`;
    case "failed":
      return `Couldn't play ${title}`;
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
