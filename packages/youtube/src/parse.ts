import { Track, trackIdForVideo, type Artist, type VideoId } from "@ytbm/core";

import { toThumbnails, type RawThumbnail } from "./thumbnails.ts";

/**
 * The shape youtubei.js hands back for a song row.
 *
 * Deliberately structural and almost entirely optional: this is a description
 * of somebody else's JSON, and the point of parsing here is that a field
 * disappearing upstream costs one track rather than throwing inside a
 * component. youtubei.js's own types are not used because they describe what
 * the library currently models, not what YouTube currently sends.
 */
export interface RawSong {
  id?: unknown;
  item_type?: unknown;
  title?: unknown;
  duration?: { seconds?: unknown } | null;
  album?: { id?: unknown; name?: unknown } | null;
  artists?: readonly { name?: unknown; channel_id?: unknown }[] | null;
  thumbnails?: readonly RawThumbnail[] | null;
  badges?: readonly { icon_type?: unknown }[] | null;
  /** The row's columns as YouTube sent them, for what youtubei.js misses. */
  flex_columns?: readonly { title?: { runs?: readonly RawRun[] } | null }[] | null;
}

interface RawRun {
  text?: unknown;
  endpoint?: { payload?: { browseId?: unknown } } | null;
}

const EXPLICIT_BADGE = "MUSIC_EXPLICIT_BADGE";

/**
 * A song row as a domain `Track`, or null if it is not one we can play.
 *
 * Null rather than throwing: a search shelf routinely mixes in podcast
 * episodes and videos with no duration, and dropping those is normal operation
 * rather than an error worth surfacing.
 */
export function toTrack(raw: RawSong): Track | null {
  const videoId = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : null;
  const title = typeof raw.title === "string" && raw.title.length > 0 ? raw.title : null;
  if (videoId === null || title === null) return null;

  const seconds = raw.duration?.seconds;
  // Live content reports no duration, and we cannot queue what has no end.
  const durationMs = typeof seconds === "number" && seconds > 0 ? Math.round(seconds * 1000) : null;

  const album = toAlbum(raw);
  const candidate = {
    id: trackIdForVideo(videoId as VideoId),
    title,
    artists: toArtists(raw.artists),
    album: album.name,
    albumId: album.id,
    durationMs,
    thumbnails: toThumbnails(raw.thumbnails ?? undefined),
    isExplicit: (raw.badges ?? []).some((badge) => badge?.icon_type === EXPLICIT_BADGE),
  };

  const result = Track.safeParse(candidate);
  return result.success ? result.data : null;
}

/**
 * youtubei.js reads the album off a song row by column position, and playlist
 * and top-songs rows put a play count where it expects the album, so there
 * it finds none. The album is still there, as the one run linking to an album
 * page; that is looked for when youtubei.js comes back empty.
 */
function toAlbum(raw: RawSong): { name: string | null; id: string | null } {
  const name = typeof raw.album?.name === "string" ? raw.album.name : null;
  const id = typeof raw.album?.id === "string" && raw.album.id.length > 0 ? raw.album.id : null;
  if (name !== null) return { name, id };
  for (const column of raw.flex_columns ?? []) {
    for (const run of column?.title?.runs ?? []) {
      const browseId = run?.endpoint?.payload?.browseId;
      const isAlbum = typeof browseId === "string" && browseId.startsWith(ALBUM_BROWSE_PREFIX);
      if (isAlbum && typeof run.text === "string") {
        return { name: run.text, id: browseId };
      }
    }
  }
  return { name: null, id: null };
}

const ALBUM_BROWSE_PREFIX = "MPREb_";

export function toArtists(raw: RawSong["artists"]): Artist[] {
  const artists: Artist[] = [];
  for (const entry of raw ?? []) {
    if (typeof entry?.name !== "string" || entry.name.length === 0) continue;
    artists.push({
      name: entry.name,
      channelId: typeof entry.channel_id === "string" ? entry.channel_id : null,
    });
  }
  return artists;
}
