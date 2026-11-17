import type { VideoId } from "@ymusic/core";

import { LIKED_MUSIC } from "./libraryPlaylists.ts";
import type { Route } from "./useBrowse.ts";

const ORIGIN = "https://music.youtube.com";

/** What "Share" links to: a song, or an album, playlist or artist page. */
export type Shared = { kind: "song"; videoId: VideoId } | Route;

/**
 * The music.youtube.com link YouTube Music's own "Share" copies, or null for
 * Liked Music, which only its owner can open. An album links to its page by
 * its browse id (`MPREb_…`), which needs no request, where YouTube copies its
 * playlist (`OLAK5uy_…`): both open the album.
 */
export function shareUrl(shared: Shared): string | null {
  switch (shared.kind) {
    case "song":
      return `${ORIGIN}/watch?v=${shared.videoId}`;
    case "album":
      return `${ORIGIN}/browse/${shared.id}`;
    case "artist":
      return `${ORIGIN}/channel/${shared.id}`;
    case "playlist":
      return shared.id === LIKED_MUSIC ? null : `${ORIGIN}/playlist?list=${shared.id}`;
  }
}
