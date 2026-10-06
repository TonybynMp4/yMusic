import { useEffect, useState } from "react";
import { videoIdFromTrackId, type Track } from "@ymusic/core";

import { engine } from "./engine.ts";

/** Looked up once per song for the whole session: a year never changes. */
const years = new Map<string, Promise<number | null>>();

/**
 * The year the track's album came out. Most tracks bring it with them; a
 * YouTube song from a playlist or search does not, and is looked up.
 */
export function useSongYear(track: Track | null): number | null {
  const videoId = track && track.year === null ? videoIdFromTrackId(track.id) : null;
  const [found, setFound] = useState<{ videoId: string; year: number | null } | null>(null);

  useEffect(() => {
    if (videoId === null) return;
    let lookup = years.get(videoId);
    if (!lookup) {
      // A failed lookup is not kept, so the next mount tries again.
      lookup = engine.songYear(videoId).catch(() => {
        years.delete(videoId);
        return null;
      });
      years.set(videoId, lookup);
    }
    let live = true;
    void lookup.then((year) => live && setFound({ videoId, year }));
    return () => {
      live = false;
    };
  }, [videoId]);

  if (track === null) return null;
  return track.year ?? (found?.videoId === videoId ? found.year : null);
}
