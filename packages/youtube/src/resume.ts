import { YTNodes, type Innertube } from "youtubei.js";
import { videoIdFromTrackId, type Track, type VideoId } from "@ymusic/core";

import { playlistIdFromBrowseId } from "./browse.ts";
import { radioFrom } from "./radio.ts";

/**
 * YouTube Music keeps each account's queue on its servers, which is how
 * "Resume" carries a queue from one device to another. A signed-in `/next`
 * that starts a queue with `enablePersistentPlaylistPanel` stores it; a
 * `/next` of type `WATCH_NEXT_TYPE_GET_QUEUE` reads it back, with the song
 * that was playing marked as selected.
 */
export interface ServerQueue {
  tracks: Track[];
  /** The song that was playing, an index into `tracks`. */
  index: number;
  /** The playlist or radio the queue plays, when it is one. */
  playlistId: string | null;
}

interface RawPanel {
  contents?: readonly unknown[] | null;
  playlist_id?: unknown;
}

interface RawRow {
  video_id?: unknown;
  selected?: unknown;
  primary?: RawRow | null;
}

/** The account's last queue, from whichever device played it. Null when there is none. */
export async function getServerQueue(youtube: Innertube): Promise<ServerQueue | null> {
  const response = await youtube.actions.execute("/next", {
    watchNextType: "WATCH_NEXT_TYPE_GET_QUEUE",
    queueContextParams: "",
    isAudioOnly: true,
    client: "YTMUSIC",
    parse: true,
  });
  const panel = response.contents_memo?.getType(YTNodes.PlaylistPanel)[0];
  return panel ? serverQueueFrom(panel as unknown as RawPanel) : null;
}

/** Exported for tests. */
export function serverQueueFrom(panel: RawPanel): ServerQueue | null {
  const tracks = radioFrom(panel, null);
  if (tracks.length === 0) return null;
  let selected: unknown = null;
  for (const item of panel.contents ?? []) {
    const row = item as RawRow | null;
    const video = row?.primary ?? row;
    if (video?.selected === true) {
      selected = video.video_id;
      break;
    }
  }
  const index = tracks.findIndex((t) => videoIdFromTrackId(t.id) === selected);
  const playlistId = typeof panel.playlist_id === "string" ? panel.playlist_id : null;
  return { tracks, index: Math.max(0, index), playlistId };
}

/**
 * Makes `videoId` the account's current queue, so other devices offer to
 * resume it. With `playlistId` the queue is that playlist from this song on;
 * without, it is the song's radio, as when a song is played on its own.
 */
export async function setServerQueue(
  youtube: Innertube,
  videoId: VideoId,
  playlistId: string | null,
): Promise<void> {
  await youtube.actions.execute("/next", {
    videoId,
    ...(playlistId ? { playlistId: playlistIdFromBrowseId(playlistId) } : {}),
    enablePersistentPlaylistPanel: true,
    tunerSettingValue: "AUTOMIX_SETTING_NORMAL",
    isAudioOnly: true,
    queueContextParams: "",
    client: "YTMUSIC",
  });
}
