import { useCallback, useRef, useState } from "react";
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch (error) {
    console.error("could not save the ratings", error);
  }
}

/** Ratings given here for one song, so an answer from YouTube can tell whether it is out of date. */
interface Given {
  /** When the last one was given, to tell a failed one whether a newer one replaced it. */
  last: number;
  /** When one last settled. An answer asked for before then may predate it. */
  settled: number;
  /** Still on their way to YouTube. An answer now may or may not include them. */
  pending: number;
}

/** What is known for one account. Replaced as a whole when the account changes. */
interface Store {
  account: string | null;
  ratings: Map<VideoId, Rating> | null;
  given: Map<VideoId, Given>;
  /** Counts ratings given and settled, to order them against answers. */
  clock: number;
}

function open(account: string | null): Store {
  return { account, ratings: account === null ? null : load(account), given: new Map(), clock: 0 };
}

/**
 * Ratings for the signed-in account: what is known, a way to record what
 * YouTube says, and a way to rate. Signed out there is nothing to know.
 */
export function useRatings(account: string | null) {
  const store = useRef<Store | null>(null);
  if (store.current?.account !== account) store.current = open(account);
  /** The store is mutated in place, so a change is announced by this counter. */
  const [, setVersion] = useState(0);

  /** Taken before asking YouTube for a rating, and passed to `learn` with the answer. */
  const now = useCallback(() => store.current!.clock, []);

  /**
   * Records a rating. Moving it to the end keeps the recent ones when trimming.
   * With `asked`, from `now`, an answer is dropped if a rating given here was
   * on its way or settled since: YouTube may have read it before that landed.
   */
  const learn = useCallback((videoId: VideoId, rating: Rating, asked?: number) => {
    const { account: owner, ratings, given } = store.current!;
    if (owner === null || ratings === null) return;
    const mine = given.get(videoId);
    if (asked !== undefined && mine && (mine.pending > 0 || mine.settled > asked)) return;
    const before = ratings.get(videoId) ?? "none";
    // Most songs are unrated: nothing to move or save.
    if (before === "none" && rating === "none") return;
    ratings.delete(videoId);
    if (rating !== "none") ratings.set(videoId, rating);
    for (const old of ratings.keys()) {
      if (ratings.size <= LIMIT) break;
      ratings.delete(old);
    }
    save(owner, ratings);
    if (before !== rating) setVersion((v) => v + 1);
  }, []);

  /** Null when signed out: the song can't be rated. */
  const ratingOf = useCallback((videoId: VideoId): Rating | null => {
    const { ratings } = store.current!;
    return ratings === null ? null : (ratings.get(videoId) ?? "none");
  }, []);

  /** Shown at once, and put back if YouTube refuses it and no newer one was given. */
  const rate = useCallback(
    async (videoId: VideoId, rating: Rating) => {
      const current = store.current!;
      const before = ratingOf(videoId) ?? "none";
      const mine = current.given.get(videoId) ?? { last: 0, settled: 0, pending: 0 };
      current.given.set(videoId, mine);
      const stamp = ++current.clock;
      mine.last = stamp;
      mine.pending++;
      learn(videoId, rating);
      try {
        await youtube.rate(videoId, rating);
      } catch (error) {
        if (store.current === current && mine.last === stamp) learn(videoId, before);
        throw error;
      } finally {
        mine.pending--;
        mine.settled = ++current.clock;
      }
    },
    [learn, ratingOf],
  );

  return { ratingOf, learn, now, rate };
}
