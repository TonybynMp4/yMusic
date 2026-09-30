import { useCallback, useEffect, useRef, useState } from "react";
import { videoIdFromTrackId, type TrackId, type VideoId } from "@ymusic/core";
import type { Rating } from "@ymusic/youtube/host";

import { engine as youtube } from "./engine.ts";

/**
 * The account's thumbs up or down on the song playing, and a way to change it.
 * `rating` is null until YouTube has answered for this song, and always for a
 * local file or while signed out.
 */
export function useRating(trackId: TrackId | null, signedIn: boolean) {
  const videoId = trackId === null ? null : videoIdFromTrackId(trackId);
  /** Songs already asked about, so going back to one does not ask again. */
  const known = useRef(new Map<VideoId, Rating>());
  const [, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((v) => v + 1), []);

  // The answers were the account's, so they go with it.
  useEffect(() => {
    if (!signedIn) known.current.clear();
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn || videoId === null || known.current.has(videoId)) return;
    let cancelled = false;
    void youtube
      .rating(videoId)
      .then((rating) => {
        if (cancelled || known.current.has(videoId)) return;
        known.current.set(videoId, rating);
        changed();
      })
      .catch((error: unknown) => console.error("could not read the song's rating", error));
    return () => {
      cancelled = true;
    };
  }, [videoId, signedIn, changed]);

  /** Shown at once, and put back if YouTube refuses it. */
  const rate = useCallback(
    async (id: VideoId, rating: Rating) => {
      const before = known.current.get(id);
      known.current.set(id, rating);
      changed();
      try {
        await youtube.rate(id, rating);
      } catch (error) {
        if (before === undefined) known.current.delete(id);
        else known.current.set(id, before);
        changed();
        throw error;
      }
    },
    [changed],
  );

  const rating = signedIn && videoId !== null ? (known.current.get(videoId) ?? null) : null;
  return { videoId, rating, rate };
}
