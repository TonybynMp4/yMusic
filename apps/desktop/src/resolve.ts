import {
  type AudioQuality,
  sourceOf,
  type StreamLease,
  type TrackId,
  videoIdFromTrackId,
} from "@ymusic/core";
import { libraryResolve } from "@ymusic/ipc";

import { engine } from "./engine.ts";

/**
 * A track id to a playable lease.
 *
 * This is the one place playback branches on where a track came from. Every
 * layer above it (the queue, the player, the UI) works in `TrackId` and
 * `StreamLease` and stays source-agnostic, which is what lets a mixed queue
 * exist at all.
 */
/**
 * `fallback` skips YouTube's usual client for the PO-token one, for a stream
 * that resolved but that mpv could not play. It and `quality` mean nothing for
 * local files, which have one format: the file.
 */
export async function resolveTrack(
  id: TrackId,
  options: { fallback?: boolean; quality?: AudioQuality } = {},
): Promise<StreamLease> {
  switch (sourceOf(id)) {
    case "local":
      return libraryResolve(id);
    case "youtube": {
      const videoId = videoIdFromTrackId(id);
      if (videoId === null) throw new Error(`not a YouTube track id: ${id}`);
      // The memory harness's `fallback` variant, to measure the PO-token path.
      if (import.meta.env.VITE_MEMORY_SCENARIO === "fallback") {
        return engine.resolve(videoId, { ...options, fallback: true });
      }
      return engine.resolve(videoId, options);
    }
  }
}
