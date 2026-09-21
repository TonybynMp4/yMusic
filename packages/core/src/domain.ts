import { z } from "zod";

/**
 * Domain models. Everything a source returns is parsed into these before it
 * crosses out of that source's adapter, so an upstream shape change surfaces as
 * a schema error at the boundary instead of an `undefined` three layers away.
 */

/** YouTube's own identifier. Only the InnerTube adapter should speak this. */
export const VideoId = z.string().min(1).brand<"VideoId">();
export type VideoId = z.infer<typeof VideoId>;

export const PlaylistId = z.string().min(1).brand<"PlaylistId">();
export type PlaylistId = z.infer<typeof PlaylistId>;

export const TrackSource = z.enum(["youtube", "local"]);
export type TrackSource = z.infer<typeof TrackSource>;

/**
 * Identity for anything playable, namespaced by source (`yt:dQw4w9WgXcQ`,
 * `local:<hash>`). The queue, the player and the UI speak only this; keeping
 * the source in the string means a mixed queue cannot collide two sources'
 * identifiers, and a persisted queue stays meaningful across restarts.
 */
export const TrackId = z
  .string()
  .regex(/^(yt|local):.+$/, "must be namespaced as `yt:` or `local:`")
  .brand<"TrackId">();
export type TrackId = z.infer<typeof TrackId>;

export function trackIdForVideo(id: VideoId): TrackId {
  return `yt:${id}` as TrackId;
}

/** Inverse of {@link trackIdForVideo}; null for anything not from YouTube. */
export function videoIdFromTrackId(id: TrackId): VideoId | null {
  return id.startsWith("yt:") ? (id.slice(3) as VideoId) : null;
}

export function sourceOf(id: TrackId): TrackSource {
  return id.startsWith("yt:") ? "youtube" : "local";
}

export const Thumbnail = z.object({
  url: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Thumbnail = z.infer<typeof Thumbnail>;

export const Artist = z.object({
  name: z.string(),
  channelId: z.string().nullable(),
});
export type Artist = z.infer<typeof Artist>;

export const Track = z.object({
  id: TrackId,
  title: z.string(),
  artists: z.array(Artist),
  album: z.string().nullable(),
  /** YouTube Music's browse id for the album page. Null for local files. */
  albumId: z.string().nullable().default(null),
  /** Missing for live content, which we do not queue. */
  durationMs: z.number().int().nonnegative().nullable(),
  thumbnails: z.array(Thumbnail),
  isExplicit: z.boolean().default(false),
});
export type Track = z.infer<typeof Track>;

/** Something a browse page links to, drawn as a card: YouTube Music's two-row item. */
export const BrowseCard = z.object({
  kind: z.enum(["album", "playlist", "artist"]),
  /** The browse id to open it with. */
  id: z.string().min(1),
  title: z.string(),
  /** "Album • 1998", "812K monthly audience" — YouTube's own summary line. */
  subtitle: z.string().nullable(),
  thumbnails: z.array(Thumbnail),
});
export type BrowseCard = z.infer<typeof BrowseCard>;

export const AlbumPage = z.object({
  id: z.string().min(1),
  title: z.string(),
  subtitle: z.string().nullable(),
  artists: z.array(Artist),
  thumbnails: z.array(Thumbnail),
  tracks: z.array(Track),
});
export type AlbumPage = z.infer<typeof AlbumPage>;

export const PlaylistPage = z.object({
  id: z.string().min(1),
  title: z.string(),
  subtitle: z.string().nullable(),
  thumbnails: z.array(Thumbnail),
  tracks: z.array(Track),
});
export type PlaylistPage = z.infer<typeof PlaylistPage>;

export const ArtistPage = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  thumbnails: z.array(Thumbnail),
  topSongs: z.array(Track),
  /** The playlist behind "Top songs", when YouTube offers the full list. */
  topSongsPlaylistId: z.string().nullable(),
  /** Albums, singles, "fans might also like" — in YouTube's order. */
  shelves: z.array(z.object({ title: z.string(), cards: z.array(BrowseCard) })),
});
export type ArtistPage = z.infer<typeof ArtistPage>;

export const AudioCodec = z.enum([
  "opus",
  "aac",
  "mp3",
  "flac",
  "alac",
  "vorbis",
  "pcm",
  "unknown",
]);
export type AudioCodec = z.infer<typeof AudioCodec>;

/**
 * A resolved, playable stream.
 *
 * Remote leases are time-limited, so `expiresAt` must be checked before handing
 * one to the player. `headers` exists for sources that bind a URL to the
 * request that fetched it; YouTube's measurably does not, so its leases carry
 * none. A local file is the degenerate case of the same shape --
 * a `file://` URL, no headers, and an `expiresAt` of null -- which is why
 * playback never needs to know which source it is playing.
 */
export const StreamLease = z.object({
  trackId: TrackId,
  url: z.url(),
  /** YouTube's format selector. Null for sources that have no such concept. */
  itag: z.number().int().nullable(),
  codec: AudioCodec,
  /** Null when the container does not report one. */
  bitrate: z.number().int().positive().nullable(),
  /** Set when the audio is the Premium-only format. Logged to verify Premium. */
  isPremiumFormat: z.boolean(),
  headers: z.record(z.string(), z.string()),
  /** Null means the lease never expires, as for a file on disk. */
  expiresAt: z.number().int().positive().nullable(),
});
export type StreamLease = z.infer<typeof StreamLease>;

/** Re-resolve rather than risk mpv opening a URL that dies mid-track. */
export const STREAM_LEASE_SAFETY_MARGIN_MS = 5 * 60 * 1000;

export function isLeaseUsable(lease: StreamLease, now: number): boolean {
  if (lease.expiresAt === null) return true;
  return lease.expiresAt - STREAM_LEASE_SAFETY_MARGIN_MS > now;
}
