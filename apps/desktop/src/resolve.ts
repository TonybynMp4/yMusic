import {
  sourceOf,
  type StreamLease,
  type TrackId,
  videoIdFromTrackId,
} from "@ytbm/core";
import { libraryResolve } from "@ytbm/ipc";

import { engine } from "./engine.ts";

/**
 * A track id to a playable lease.
 *
 * This is the one place playback branches on where a track came from. Every
 * layer above it — the queue, the player, the UI — works in `TrackId` and
 * `StreamLease` and stays source-agnostic, which is what lets a mixed queue
 * exist at all.
 */
/**
 * `fallback` skips YouTube's usual client for the PO-token one — for a stream
 * that resolved but that mpv could not play. Meaningless for local files.
 */
export async function resolveTrack(
  id: TrackId,
  options: { fallback?: boolean } = {},
): Promise<StreamLease> {
  switch (sourceOf(id)) {
    case "local":
      return libraryResolve(id);
    case "youtube": {
      const videoId = videoIdFromTrackId(id);
      if (videoId === null) throw new Error(`not a YouTube track id: ${id}`);
      return engine.resolve(videoId, options);
    }
  }
}
