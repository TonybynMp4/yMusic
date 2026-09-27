import type { VideoId } from "@ymusic/core";
import type { Innertube } from "youtubei.js";

/**
 * Where YouTube Music's web player reports a song as it plays: once when it
 * starts, which puts it in the account's history, and then every so often
 * with the stretches actually listened to (watch time), which is what
 * recommendations and "Resume" on other devices go by.
 */
export interface PlaybackTracking {
  playbackUrl: string;
  watchtimeUrl: string;
}

/** Who a report claims to come from, the client that asked for the tracking URLs. */
export interface StatsClient {
  name: string;
  version: string;
}

/** How a song has played since the last report. */
export interface WatchReport {
  /** Stretches listened to since the last report, `[start, end]` in ms. */
  segments: [number, number][];
  positionMs: number;
  playing: boolean;
  /** The song is done with: it ended, was skipped or the app is closing. */
  final: boolean;
}

interface RawPlayer {
  playbackTracking?: {
    videostatsPlaybackUrl?: { baseUrl?: string };
    videostatsWatchtimeUrl?: { baseUrl?: string };
  };
}

/**
 * The tracking URLs, from a signed-in YouTube Music `/player` call made for
 * nothing else: the stream itself comes from the anonymous `VISIONOS` client.
 * Without the player's signature timestamp YouTube answers "unplayable" and
 * leaves the URLs out. Null when it gives none.
 */
export async function getPlaybackTracking(
  youtube: Innertube,
  videoId: VideoId,
  signatureTimestamp: number,
): Promise<PlaybackTracking | null> {
  const response = await youtube.actions.execute("/player", {
    videoId,
    client: "YTMUSIC",
    playbackContext: { contentPlaybackContext: { signatureTimestamp } },
  });
  return trackingFrom(response.data as RawPlayer);
}

export function trackingFrom(data: RawPlayer): PlaybackTracking | null {
  const playbackUrl = data.playbackTracking?.videostatsPlaybackUrl?.baseUrl;
  const watchtimeUrl = data.playbackTracking?.videostatsWatchtimeUrl?.baseUrl;
  if (!playbackUrl || !watchtimeUrl) return null;
  return { playbackUrl, watchtimeUrl };
}

/**
 * A client playback nonce: sixteen characters naming one play of one song,
 * shared by every report about it.
 */
export function newCpn(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b & 63]).join("");
}

/** A play, as the reports about it need to name it. */
export interface Play {
  tracking: PlaybackTracking;
  client: StatsClient;
  cpn: string;
  /** When the play started, for the elapsed time each report carries. */
  startedAt: number;
}

/** The "this song started" report. */
export function playbackPing(play: Play, now: number): string {
  return statsUrl(play, play.tracking.playbackUrl, { rt: elapsed(play, now) });
}

export function watchtimePing(play: Play, report: WatchReport, now: number): string {
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  return statsUrl(play, play.tracking.watchtimeUrl, {
    st: report.segments.map(([start]) => seconds(start)).join(","),
    et: report.segments.map(([, end]) => seconds(end)).join(","),
    cmt: seconds(report.positionMs),
    state: report.playing ? "playing" : "paused",
    rt: elapsed(play, now),
    ...(report.final ? { final: "1" } : {}),
  });
}

/**
 * The web player sends these to `music.youtube.com`, where the session cookie
 * applies; YouTube hands them out on `s.youtube.com`.
 */
function statsUrl(play: Play, base: string, params: Record<string, string>): string {
  const url = new URL(base.replace(/^https:\/\/s\./, "https://music."));
  url.searchParams.set("ver", "2");
  url.searchParams.set("c", play.client.name);
  url.searchParams.set("cver", play.client.version);
  url.searchParams.set("cpn", play.cpn);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function elapsed(play: Play, now: number): string {
  return ((now - play.startedAt) / 1000).toFixed(3);
}
