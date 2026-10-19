import { queryOptions, useQuery } from "@tanstack/react-query";
import { videoIdFromTrackId, type Track, type VideoId } from "@ymusic/core";

import { engine } from "./engine.ts";
import { capQueries, queryClient } from "./query.ts";

/**
 * Looked up once per song, since a year never changes. Capped so a session
 * that runs for days does not keep every song it ever showed; the oldest
 * lookups go first, however recently they were shown. A failed lookup is
 * tried again the next time the song shows.
 */
const MAX_YEARS = 500;

capQueries(["song-year"], MAX_YEARS);

function yearOptions(videoId: VideoId) {
  return queryOptions({
    queryKey: ["song-year", videoId],
    queryFn: () => engine.songYear(videoId),
    gcTime: Infinity,
  });
}

/** The year a YouTube song came out, from the cache when it was looked up before. */
export function lookUpYear(videoId: VideoId): Promise<number | null> {
  return queryClient.fetchQuery(yearOptions(videoId)).catch(() => null);
}

/** Forgets the years looked up so far. */
export function clearSongYears(): void {
  queryClient.removeQueries({ queryKey: ["song-year"] });
}

/**
 * The year the track's album came out. Most tracks bring it with them; a
 * YouTube song from a playlist or search does not, and is looked up.
 */
export function useSongYear(track: Track | null): number | null {
  const videoId = track && track.year === null ? videoIdFromTrackId(track.id) : null;
  const { data } = useQuery({
    ...yearOptions(videoId ?? ("" as VideoId)),
    enabled: videoId !== null,
  });
  if (track === null) return null;
  return track.year ?? data ?? null;
}
