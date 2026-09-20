import {
  sourceOf,
  type StreamLease,
  type TrackId,
  videoIdFromTrackId,
} from "@ytbm/core";
import { appFetch, libraryResolve } from "@ytbm/ipc";
import { createPlayer, resolveStream } from "@ytbm/youtube";
import type { Innertube } from "youtubei.js";

/**
 * The player client, created once for the life of the app.
 *
 * `createPlayer` downloads and interprets YouTube's player JavaScript, which is
 * the slowest part of this whole path; doing it per track would put a visible
 * stall in front of every play. Held as the promise rather than the client so
 * two tracks resolving at once share one creation instead of racing two.
 */
let player: Promise<Innertube> | null = null;

function playerClient(): Promise<Innertube> {
  player ??= createPlayer({ fetch: appFetch }).catch((error: unknown) => {
    // A rejected promise left in place would be reused forever, so the app
    // could never recover from one bad startup. Clear it and let the next
    // play try again.
    player = null;
    throw error;
  });
  return player;
}

/**
 * A track id to a playable lease.
 *
 * This is the one place playback branches on where a track came from. Every
 * layer above it — the queue, the player, the UI — works in `TrackId` and
 * `StreamLease` and stays source-agnostic, which is what lets a mixed queue
 * exist at all.
 */
export async function resolveTrack(id: TrackId): Promise<StreamLease> {
  switch (sourceOf(id)) {
    case "local":
      return libraryResolve(id);
    case "youtube": {
      const videoId = videoIdFromTrackId(id);
      if (videoId === null) throw new Error(`not a YouTube track id: ${id}`);
      return resolveStream(await playerClient(), videoId);
    }
  }
}
