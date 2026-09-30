import { useCallback, useMemo, useState } from "react";
import type { VideoId } from "@ymusic/core";
import type { Rating } from "@ymusic/youtube/host";

import { engine as youtube } from "./engine.ts";

const STORAGE_KEY = "ymusic.ratings";
/** Liked and disliked songs remembered. The oldest answers go first. */
const LIMIT = 5000;

interface Stored {
  account: string;
  /** Oldest first. Only likes and dislikes: a song missing is unrated. */
  ratings: [VideoId, Rating][];
}

/**
 * The account's ratings as last seen, kept across restarts so a disliked
 * song can be skipped before it loads rather than after YouTube says so.
 * Answers come for free with the `/next` each play already sends, and from
 * rating a song here. Another account's are thrown away.
 */
function load(account: string): Map<VideoId, Rating> {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Stored | null;
    if (stored?.account === account) return new Map(stored.ratings);
  } catch (error) {
    console.error("could not read the saved ratings", error);
  }
  return new Map();
}

function save(account: string, ratings: Map<VideoId, Rating>): void {
  const stored: Stored = { account, ratings: [...ratings] };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

/**
 * Ratings for the signed-in account: what is known, a way to record what
 * YouTube says, and a way to rate. Signed out there is nothing to know.
 */
export function useRatings(account: string | null) {
  const ratings = useMemo(() => (account === null ? null : load(account)), [account]);
  const [, setVersion] = useState(0);

  /** Records a rating. Moving it to the end keeps the recent ones when trimming. */
  const learn = useCallback(
    (videoId: VideoId, rating: Rating) => {
      if (account === null || ratings === null) return;
      const before = ratings.get(videoId) ?? "none";
      ratings.delete(videoId);
      if (rating !== "none") ratings.set(videoId, rating);
      for (const old of ratings.keys()) {
        if (ratings.size <= LIMIT) break;
        ratings.delete(old);
      }
      save(account, ratings);
      if (before !== rating) setVersion((v) => v + 1);
    },
    [account, ratings],
  );

  /** Null when signed out: the song can't be rated. */
  const ratingOf = useCallback(
    (videoId: VideoId): Rating | null => (ratings === null ? null : (ratings.get(videoId) ?? "none")),
    [ratings],
  );

  /** Shown at once, and put back if YouTube refuses it. */
  const rate = useCallback(
    async (videoId: VideoId, rating: Rating) => {
      const before = ratingOf(videoId) ?? "none";
      learn(videoId, rating);
      try {
        await youtube.rate(videoId, rating);
      } catch (error) {
        learn(videoId, before);
        throw error;
      }
    },
    [learn, ratingOf],
  );

  return { ratingOf, learn, rate };
}
