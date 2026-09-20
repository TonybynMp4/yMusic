import type { Innertube } from "youtubei.js";
import type { Track } from "@ytbm/core";

import { toTrack, type RawSong } from "./parse.ts";

/** Shelf carrying the song results. Other shelves are notices and suggestions. */
const SONG_SHELF = "MusicShelf";

interface SearchResponse {
  contents?: readonly { type?: unknown; contents?: readonly unknown[] }[] | null;
}

export async function searchSongs(youtube: Innertube, query: string): Promise<Track[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const response = (await youtube.music.search(trimmed, {
    type: "song",
  })) as unknown as SearchResponse;
  return songsFrom(response);
}

/**
 * The song rows out of a music search response.
 *
 * Exported for tests, and split from the request so the shelf-picking rule can
 * be exercised without the network. That rule is the fragile part: a search
 * response leads with an `ItemSection` holding a `Message` — a "did you mean"
 * notice — so taking the first shelf that has contents returns notices instead
 * of songs. The shelf has to be selected by type.
 */
export function songsFrom(response: SearchResponse): Track[] {
  const shelf = (response.contents ?? []).find((section) => section?.type === SONG_SHELF);
  const tracks: Track[] = [];
  for (const row of shelf?.contents ?? []) {
    const track = toTrack(row as RawSong);
    if (track !== null) tracks.push(track);
  }
  return tracks;
}
