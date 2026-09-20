import { z } from "zod";

/**
 * Domain models. Everything InnerTube returns is parsed into these before it
 * crosses out of the data engine, so an upstream shape change surfaces as a
 * schema error at the boundary instead of an `undefined` three layers away.
 */

export const VideoId = z.string().min(1).brand<"VideoId">();
export type VideoId = z.infer<typeof VideoId>;

export const PlaylistId = z.string().min(1).brand<"PlaylistId">();
export type PlaylistId = z.infer<typeof PlaylistId>;

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
  id: VideoId,
  title: z.string(),
  artists: z.array(Artist),
  album: z.string().nullable(),
  /** Missing for live content, which we do not queue. */
  durationMs: z.number().int().nonnegative().nullable(),
  thumbnails: z.array(Thumbnail),
  isExplicit: z.boolean().default(false),
});
export type Track = z.infer<typeof Track>;

export const AudioCodec = z.enum(["opus", "aac", "unknown"]);
export type AudioCodec = z.infer<typeof AudioCodec>;

/**
 * A resolved, playable stream. Session-bound and time-limited: googlevideo ties
 * the URL to the headers that resolved it, so `headers` must be replayed by
 * whatever performs the actual playback, and `expiresAt` must be checked before
 * handing it to the player.
 */
export const StreamLease = z.object({
  trackId: VideoId,
  url: z.url(),
  itag: z.number().int(),
  codec: AudioCodec,
  bitrate: z.number().int().positive(),
  /** Set when the audio is the Premium-only format. Logged to verify Premium. */
  isPremiumFormat: z.boolean(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.number().int().positive(),
});
export type StreamLease = z.infer<typeof StreamLease>;

/** Re-resolve rather than risk mpv opening a URL that dies mid-track. */
export const STREAM_LEASE_SAFETY_MARGIN_MS = 5 * 60 * 1000;

export function isLeaseUsable(lease: StreamLease, now: number): boolean {
  return lease.expiresAt - STREAM_LEASE_SAFETY_MARGIN_MS > now;
}
