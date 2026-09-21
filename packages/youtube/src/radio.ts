import type { Innertube } from "youtubei.js";
import type { Track, VideoId } from "@ytbm/core";

import { toTrack, type RawSong } from "./parse.ts";
import type { RawThumbnail } from "./thumbnails.ts";

/** A row of YouTube Music's up-next panel, as youtubei.js 18 returns one. */
interface RawPanelVideo {
  type?: unknown;
  video_id?: unknown;
  title?: { toString(): string } | string | null;
  duration?: { seconds?: unknown } | null;
  album?: { id?: unknown; name?: unknown } | null;
  artists?: readonly { name?: unknown; channel_id?: unknown }[] | null;
  thumbnail?: readonly RawThumbnail[] | null;
  badges?: readonly { icon_type?: unknown }[] | null;
  /** Set on a `PlaylistPanelVideoWrapper`, which holds the row itself. */
  primary?: RawPanelVideo | null;
}

interface UpNextResponse {
  contents?: readonly unknown[] | null;
}

/**
 * What YouTube Music would play after `videoId`: the song radio behind its
 * up-next panel and its autoplay. The seed itself leads the panel and is left
 * out.
 */
export async function getRadio(youtube: Innertube, videoId: VideoId): Promise<Track[]> {
  const panel = (await youtube.music.getUpNext(videoId, true)) as unknown as UpNextResponse;
  return radioFrom(panel, videoId);
}

/** Exported for tests, like `songsFrom`. */
export function radioFrom(panel: UpNextResponse, seed: VideoId): Track[] {
  const tracks: Track[] = [];
  const seen = new Set<string>([seed]);
  for (const item of panel.contents ?? []) {
    const row = item as RawPanelVideo | null;
    const video = row?.primary ?? row;
    if (!video || typeof video.video_id !== "string" || seen.has(video.video_id)) continue;
    seen.add(video.video_id);
    const raw: RawSong = {
      id: video.video_id,
      title: video.title?.toString(),
      duration: video.duration ?? null,
      album: video.album ?? null,
      artists: video.artists ?? null,
      thumbnails: video.thumbnail ?? null,
      badges: video.badges ?? null,
    };
    const track = toTrack(raw);
    if (track !== null) tracks.push(track);
  }
  return tracks;
}
