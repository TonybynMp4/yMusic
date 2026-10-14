import { useEffect, useState } from "react";
import { videoIdFromTrackId, type Track, type VideoId } from "@ymusic/core";

import { engine } from "./engine.ts";

/**
 * Looked up once per song, since a year never changes. Capped so a session
 * that runs for days does not keep every song it ever showed; the oldest
 * lookups go first.
 */
const years = new Map<string, Promise<number | null>>();
const MAX_YEARS = 500;

/** The year a YouTube song came out, from the cache when it was looked up before. */
export function lookUpYear(videoId: VideoId): Promise<number | null> {
  let lookup = years.get(videoId);
  if (!lookup) {
    // A failed lookup is not kept, so the next mount tries again.
    lookup = engine.songYear(videoId).catch(() => {
      years.delete(videoId);
      return null;
    });
    years.set(videoId, lookup);
    for (const oldest of years.keys()) {
      if (years.size <= MAX_YEARS) break;
      years.delete(oldest);
    }
  }
  return lookup;
}

/** Forgets the years looked up so far. */
export function clearSongYears(): void {
  years.clear();
}

/**
 * The year the track's album came out. Most tracks bring it with them; a
 * YouTube song from a playlist or search does not, and is looked up.
 */
export function useSongYear(track: Track | null): number | null {
  const videoId = track && track.year === null ? videoIdFromTrackId(track.id) : null;
  const [found, setFound] = useState<{ videoId: string; year: number | null } | null>(null);

  useEffect(() => {
    if (videoId === null) return;
    let live = true;
    void lookUpYear(videoId).then((year) => live && setFound({ videoId, year }));
    return () => {
      live = false;
    };
  }, [videoId]);

  if (track === null) return null;
  return track.year ?? (found?.videoId === videoId ? found.year : null);
}
