import { isLeaseUsable, type StreamLease, type TrackId } from "@ymusic/core";

/**
 * Stores a lease, dropping the expired ones: a long session resolves hundreds.
 * A lease that never expires (a local file's) is not stored, since pruning
 * would never drop it and resolving the file again only reads the disk.
 */
export function keepLease(
  leases: Map<TrackId, StreamLease>,
  id: TrackId,
  lease: StreamLease,
  now = Date.now(),
): void {
  for (const [other, old] of leases) {
    if (!isLeaseUsable(old, now)) leases.delete(other);
  }
  if (lease.expiresAt === null) leases.delete(id);
  else leases.set(id, lease);
}
