import { videoIdFromTrackId, type Track, type VideoId } from "@ymusic/core";

/**
 * What this device last made the account's server queue: the song, and the
 * playlist it named, or null for the song's radio. Kept free of youtubei.js
 * so the main thread can compare it with the server queue.
 */
export interface SharedQueue {
  videoId: VideoId;
  playlistId: string | null;
}

/**
 * Whether the server queue is still the one this device wrote, so nothing
 * has played on another device since. The selected song must be the one
 * shared, and the playlist the one named; a song shared on its own leaves a
 * radio (`RD...`) or no playlist at all.
 */
export function isSharedQueue(
  server: { tracks: readonly Track[]; index: number; playlistId: string | null },
  shared: SharedQueue,
): boolean {
  const selected = server.tracks[server.index];
  if (!selected || videoIdFromTrackId(selected.id) !== shared.videoId) return false;
  if (shared.playlistId === null) {
    return server.playlistId === null || server.playlistId.startsWith("RD");
  }
  return server.playlistId !== null && bare(server.playlistId) === bare(shared.playlistId);
}

/** A playlist's id without the `VL` its browse id carries. */
function bare(id: string): string {
  return id.startsWith("VL") ? id.slice(2) : id;
}
