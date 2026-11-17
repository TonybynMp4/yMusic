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

/** Where the share dialog sends a link, as YouTube Music's web dialog offers. */
export interface ShareTarget {
  id: "whatsapp" | "facebook" | "x" | "email" | "reddit" | "telegram";
  label: string;
  url: string;
}

/** The share dialog's targets for `url`, with `title` where the site takes one. */
export function shareTargets(url: string, title: string | null): ShareTarget[] {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title ?? "");
  const withTitle = (key: string) => (title ? `&${key}=${t}` : "");
  return [
    { id: "whatsapp", label: "WhatsApp", url: `https://wa.me/?text=${u}` },
    { id: "facebook", label: "Facebook", url: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { id: "x", label: "X", url: `https://x.com/intent/tweet?url=${u}${withTitle("text")}` },
    { id: "email", label: "Email", url: `mailto:?body=${u}${withTitle("subject")}` },
    {
      id: "reddit",
      label: "Reddit",
      url: `https://www.reddit.com/submit?url=${u}${withTitle("title")}`,
    },
    {
      id: "telegram",
      label: "Telegram",
      url: `https://t.me/share/url?url=${u}${withTitle("text")}`,
    },
  ];
}
