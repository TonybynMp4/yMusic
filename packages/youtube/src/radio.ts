import { YTNodes, type Innertube } from "youtubei.js";
import { trackIdForVideo, type Track, type VideoId } from "@ymusic/core";

import { playlistIdFromBrowseId } from "./browse.ts";
import { toTrack, type RawSong } from "./parse.ts";
import type { RawThumbnail } from "./thumbnails.ts";

/** A row of YouTube Music's up-next panel, as youtubei.js 18 returns one. */
interface RawPanelVideo {
  type?: unknown;
  video_id?: unknown;
  title?: { toString(): string } | string | null;
  duration?: { seconds?: unknown } | null;
  album?: { id?: unknown; name?: unknown; year?: unknown } | null;
  artists?: readonly { name?: unknown; channel_id?: unknown }[] | null;
  thumbnail?: readonly RawThumbnail[] | null;
  badges?: readonly { icon_type?: unknown }[] | null;
  /** Set on a `PlaylistPanelVideoWrapper`, which holds the row itself. */
  primary?: RawPanelVideo | null;
}

interface UpNextResponse {
  contents?: readonly unknown[] | null;
  /** A token for the next page; youtubei.js leaves it null on the last. */
  continuation?: unknown;
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

/** What YouTube Music's own Shuffle buttons send with a playlist. */
const SHUFFLE_PARAMS = "wAEB8gECKAE=";

/** A page of YouTube Music's shuffle and, when there is one, the token for the next. */
export interface ShufflePage {
  tracks: Track[];
  more: string | null;
}

/**
 * YouTube Music's own shuffle of a playlist or an album's `OLAK5uy…`
 * playlist, with or without the `VL` browse prefix, fifty songs a page. The server draws with
 * replacement, so a long playlist repeats songs, sometimes within a page.
 * The token is a plain string, so unlike a youtubei.js continuation it can
 * cross the worker boundary as it is.
 */
export async function getShuffle(youtube: Innertube, playlistId: string): Promise<ShufflePage> {
  const response = await youtube.actions.execute("/next", {
    playlistId: playlistIdFromBrowseId(playlistId),
    params: SHUFFLE_PARAMS,
    isAudioOnly: true,
    client: "YTMUSIC",
    parse: true,
  });
  return shufflePageFrom(response.contents_memo?.getType(YTNodes.PlaylistPanel)[0]);
}

export async function getShuffleMore(youtube: Innertube, more: string): Promise<ShufflePage> {
  const response = await youtube.actions.execute("/next", {
    continuation: more,
    isAudioOnly: true,
    client: "YTMUSIC",
    parse: true,
  });
  return shufflePageFrom(response.continuation_contents);
}

/** Exported for tests. */
export function shufflePageFrom(panel: unknown): ShufflePage {
  const page = (panel ?? {}) as UpNextResponse;
  return {
    tracks: radioFrom(page, null),
    more: typeof page.continuation === "string" ? page.continuation : null,
  };
}

/**
 * The year `videoId`'s album came out, from the song's own row in its up-next
 * panel: the one place YouTube puts it for a song on its own. Null when the
 * row has no album, as for a music video.
 */
export async function getSongYear(youtube: Innertube, videoId: VideoId): Promise<number | null> {
  const response = await youtube.actions.execute("/next", {
    videoId,
    isAudioOnly: true,
    client: "YTMUSIC",
    parse: true,
  });
  const panel = response.contents_memo?.getType(YTNodes.PlaylistPanel)[0];
  const tracks = radioFrom((panel ?? {}) as unknown as UpNextResponse, null);
  return tracks.find((track) => track.id === trackIdForVideo(videoId))?.year ?? null;
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
      // youtubei.js only reads an album off a byline with an album run, and
      // takes the last run as its year. With no year run that is the album's
      // own name, which an album called "1999" would pass off as a year.
      year: video.album?.year === video.album?.name ? undefined : video.album?.year,
    };
    const track = toTrack(raw);
    if (track !== null) tracks.push(track);
  }
  return tracks;
}
