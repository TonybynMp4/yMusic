import {
  type AudioCodec,
  type StreamLease,
  type TrackId,
  trackIdForVideo,
  type VideoId,
} from "@ytbm/core";
import type { Innertube } from "youtubei.js";

/**
 * A format as the player endpoint describes it.
 *
 * Structural, like `RawSong`, rather than youtubei.js's own `Format`: this
 * names only the handful of fields that matter here, so a library type change
 * shows up as a compile error on a field we actually read.
 */
export interface RawFormat {
  itag?: number;
  mime_type?: string;
  bitrate?: number;
  has_audio?: boolean;
  has_video?: boolean;
  is_drc?: boolean;
  decipher: (player: unknown) => Promise<string> | string;
}

export interface PlayerResponse {
  playability_status?: { status?: string; reason?: string } | null;
  streaming_data?: { adaptive_formats?: readonly RawFormat[] } | null;
}

/** Raised when YouTube will not serve the track, with its own words for why. */
export class NotPlayableError extends Error {
  constructor(
    readonly status: string,
    reason: string | null,
  ) {
    super(reason ? `${status}: ${reason}` : status);
    this.name = "NotPlayableError";
  }
}

/**
 * The shape youtubei.js throws for an unplayable video: its own error class,
 * carrying the playability status it refused on.
 */
interface PlayabilityError {
  info?: { status?: string; reason?: string };
}

function playabilityOf(error: unknown): { status: string; reason: string | null } | null {
  const info = (error as PlayabilityError | null)?.info;
  if (!info || typeof info.status !== "string") return null;
  return { status: info.status, reason: info.reason ?? null };
}

/**
 * `getBasicInfo`, with an unplayable track reported the same way whether
 * YouTube said so in the response or youtubei.js threw about it.
 *
 * It does both, depending on the reason: a blocked track comes back as a
 * status to read, a missing one is thrown as an `InnertubeError`. Callers that
 * want to tell "cannot play this" from "the network broke" should not have to
 * know which of those happened.
 */
async function basicInfo(youtube: Innertube, videoId: VideoId): Promise<PlayerResponse> {
  try {
    return (await youtube.getBasicInfo(videoId)) as unknown as PlayerResponse;
  } catch (error) {
    const playability = playabilityOf(error);
    if (playability === null) throw error;
    throw new NotPlayableError(playability.status, playability.reason);
  }
}

/**
 * The audio-only format to play.
 *
 * Audio-only deliberately: the video-bearing formats carry a picture nobody is
 * going to look at, at several times the bitrate. Highest bitrate among those,
 * because they are all lossy and there is no reason to pick a worse one.
 *
 * DRC formats are skipped. They are the same audio with dynamic range
 * compression already applied, which is a mastering decision the listener did
 * not ask us to make.
 */
export function bestAudioFormat(formats: readonly RawFormat[]): RawFormat | null {
  const audio = formats.filter((f) => f.has_audio === true && f.has_video !== true && !f.is_drc);
  if (audio.length === 0) return null;
  return audio.reduce((best, f) => ((f.bitrate ?? 0) > (best.bitrate ?? 0) ? f : best));
}

const CODECS: ReadonlyArray<readonly [string, AudioCodec]> = [
  ["opus", "opus"],
  ["mp4a", "aac"],
  ["aac", "aac"],
  ["vorbis", "vorbis"],
  ["mp3", "mp3"],
  ["flac", "flac"],
];

/** The codec out of a mime type like `audio/webm; codecs="opus"`. */
export function codecFromMimeType(mimeType: string | undefined): AudioCodec {
  const lower = (mimeType ?? "").toLowerCase();
  return CODECS.find(([needle]) => lower.includes(needle))?.[1] ?? "unknown";
}

/**
 * When the URL stops working, from its own `expire` parameter.
 *
 * Read off the URL rather than computed from a TTL we assume: googlevideo
 * states the deadline, and `isLeaseUsable` re-resolves before it. Measured at
 * six hours, but nothing here depends on that staying true.
 */
export function expiryFromUrl(url: string): number | null {
  const expire = new URL(url).searchParams.get("expire");
  if (expire === null) return null;
  const seconds = Number(expire);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

export function leaseFrom(
  trackId: TrackId,
  format: RawFormat,
  url: string,
): StreamLease {
  return {
    trackId,
    url,
    itag: format.itag ?? null,
    codec: codecFromMimeType(format.mime_type),
    bitrate: format.bitrate && format.bitrate > 0 ? format.bitrate : null,
    isPremiumFormat: false,
    // Empty, and measured to be correct: these URLs serve any client that asks
    // for them, so there is nothing for mpv to replay. See `resolveStream`.
    headers: {},
    expiresAt: expiryFromUrl(url),
  };
}

/**
 * A video id to a lease mpv can open.
 *
 * Needs a client built by `createPlayer`, not the search client — see there for
 * why the distinction is load-bearing.
 */
export async function resolveStream(
  youtube: Innertube,
  videoId: VideoId,
): Promise<StreamLease> {
  const info = await basicInfo(youtube, videoId);

  const status = info.playability_status?.status ?? "UNKNOWN";
  if (status !== "OK") {
    throw new NotPlayableError(status, info.playability_status?.reason ?? null);
  }

  const format = bestAudioFormat(info.streaming_data?.adaptive_formats ?? []);
  if (format === null) throw new NotPlayableError("NO_AUDIO_FORMAT", null);

  const url = await format.decipher(youtube.session.player);
  return leaseFrom(trackIdForVideo(videoId), format, url);
}
