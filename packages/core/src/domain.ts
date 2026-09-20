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
  /** Missing for live content, which we do not queue. */
  durationMs: z.number().int().nonnegative().nullable(),
  thumbnails: z.array(Thumbnail),
  isExplicit: z.boolean().default(false),
});
export type Track = z.infer<typeof Track>;

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
 * Remote leases are session-bound and time-limited: googlevideo ties the URL to
 * the headers that resolved it, so `headers` must be replayed by whatever
 * performs the actual playback, and `expiresAt` must be checked before handing
 * it to the player. A local file is the degenerate case of the same shape --
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
