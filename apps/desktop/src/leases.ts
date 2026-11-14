import { queryOptions } from "@tanstack/react-query";
import {
  type AudioQuality,
  sourceOf,
  STREAM_LEASE_SAFETY_MARGIN_MS,
  type StreamLease,
  type TrackId,
} from "@ymusic/core";

import { queryClient } from "./query.ts";
import { resolveTrack } from "./resolve.ts";

/** How long a YouTube lease lasts, about: after that an unused one is dropped. */
const LEASE_LIFETIME_MS = 6 * 60 * 60 * 1000;

/**
 * How long a lease stored at `updatedAt` can be handed to mpv: until the
 * safety margin before its URL expires. A local file's never expires.
 */
export function leaseStaleTime(lease: StreamLease | undefined, updatedAt: number): number {
  if (lease === undefined) return 0;
  if (lease.expiresAt === null) return Infinity;
  return Math.max(0, lease.expiresAt - STREAM_LEASE_SAFETY_MARGIN_MS - updatedAt);
}

export function leaseKey(quality: AudioQuality, id: TrackId) {
  return ["stream", quality, id] as const;
}

// Defaults rather than options, so a lease stored directly (the retry after
// mpv refused one) expires the same way.
queryClient.setQueryDefaults(["stream"], {
  staleTime: (query) =>
    leaseStaleTime(query.state.data as StreamLease | undefined, query.state.dataUpdatedAt),
  gcTime: LEASE_LIFETIME_MS,
});

/**
 * A track's stream at `quality`, kept so going back to it, and the gapless
 * pre-resolve of the next track, skip a request while its URL is good. The
 * load and the pre-resolve share one request. A change of quality is another
 * key, so leases resolved for the old one are never handed out.
 *
 * Nothing observes these, so each is dropped once unused for its lifetime,
 * by which time it has expired. A local file's is not kept at all: resolving
 * the file again only reads the disk.
 */
export function leaseOptions(quality: AudioQuality, id: TrackId) {
  return queryOptions({
    queryKey: leaseKey(quality, id),
    queryFn: () => resolveTrack(id, { quality }),
    ...(sourceOf(id) === "local" && { gcTime: 0 }),
  });
}
