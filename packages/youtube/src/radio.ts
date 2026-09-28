import { YTNodes, type Innertube } from "youtubei.js";
import type { Track, VideoId } from "@ymusic/core";

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

/**
 * A mix of a whole list: "Start mix" on an album, playlist or artist. It is
 * the up-next panel of a radio playlist (`RDAMPL…` for an album or playlist,
 * the artist's own `RDEM…`), and unlike a song radio it keeps its first song.
 */
export async function getMix(
  youtube: Innertube,
  playlistId: string,
  videoId: string | null,
): Promise<Track[]> {
  const response = await youtube.actions.execute("/next", {
    playlistId,
    ...(videoId ? { videoId } : {}),
    // What YouTube Music's own "Start mix" buttons send.
    params: "wAEB",
    client: "YTMUSIC",
    parse: true,
  });
  const panel = response.contents_memo?.getType(YTNodes.PlaylistPanel)[0];
  return radioFrom((panel ?? {}) as unknown as UpNextResponse, null);
}

/** Exported for tests, like `songsFrom`. `seed`, the song the radio grew from, is left out. */
export function radioFrom(panel: UpNextResponse, seed: VideoId | null): Track[] {
  const tracks: Track[] = [];
  const seen = new Set<string>(seed ? [seed] : []);
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
