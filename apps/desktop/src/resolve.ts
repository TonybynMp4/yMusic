import { sourceOf, type StreamLease, type TrackId } from "@ytbm/core";
import { libraryResolve } from "@ytbm/ipc";

/**
 * Thrown for a source that can be browsed but not yet played, so the reason
 * reaches the user instead of surfacing as a failed `invoke` deep in a hook.
 */
export class NotPlayableYetError extends Error {
  constructor() {
    super("Playing YouTube tracks needs stream resolution, which is not wired up yet.");
    this.name = "NotPlayableYetError";
  }
}

/**
 * A track id to a playable lease.
 *
 * This is the one place playback branches on where a track came from. Every
 * layer above it — the queue, the player, the UI — works in `TrackId` and
 * `StreamLease` and stays source-agnostic, which is what lets a mixed queue
 * exist at all. Adding YouTube playback means filling in the other branch.
 */
export async function resolveTrack(id: TrackId): Promise<StreamLease> {
  switch (sourceOf(id)) {
    case "local":
      return libraryResolve(id);
    case "youtube":
      throw new NotPlayableYetError();
  }
}
