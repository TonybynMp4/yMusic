import { useEffect, useState, useSyncExternalStore } from "react";
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

/**
 * What is known for one account, mutated in place. A new account gets a new
 * store. `ratingOf` is replaced on every change, so React sees the change in
 * its identity and anything memoized on it updates.
 */
class RatingStore {
  readonly account: string | null;
  readonly #ratings: Map<VideoId, Rating> | null;
  readonly #given = new Map<VideoId, Given>();
  /** Counts ratings given and settled, to order them against answers. */
  #clock = 0;
  #ratingOf: (videoId: VideoId) => Rating | null;
  readonly #listeners = new Set<() => void>();
  /** Cleared once another account's store replaces it, so late answers are dropped. */
  #live = true;

  constructor(account: string | null) {
    this.account = account;
    this.#ratings = account === null ? null : load(account);
    this.#ratingOf = this.#reader();
  }

  /** Null when signed out: the song can't be rated. */
  #reader(): (videoId: VideoId) => Rating | null {
    const ratings = this.#ratings;
    return (videoId) => (ratings === null ? null : (ratings.get(videoId) ?? "none"));
  }

  /** Marks the store as the one in use until the returned cleanup runs. */
  attach = (): (() => void) => {
    this.#live = true;
    return () => {
      this.#live = false;
    };
  };

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };

  /** The current `ratingOf`, for `useSyncExternalStore`. */
  getRatingOf = (): ((videoId: VideoId) => Rating | null) => this.#ratingOf;

  /** Taken before asking YouTube for a rating, and passed to `learn` with the answer. */
  now = (): number => this.#clock;

  /**
   * Records a rating. Moving it to the end keeps the recent ones when trimming.
   * With `asked`, from `now`, an answer is dropped if a rating given here was
   * on its way or settled since: YouTube may have read it before that landed.
   */
  learn = (videoId: VideoId, rating: Rating, asked?: number): void => {
    const owner = this.account;
    const ratings = this.#ratings;
    if (owner === null || ratings === null || !this.#live) return;
    const mine = this.#given.get(videoId);
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
    if (before === rating) return;
    this.#ratingOf = this.#reader();
    for (const listener of this.#listeners) listener();
  };

  /** Shown at once, and put back if YouTube refuses it and no newer one was given. */
  rate = async (videoId: VideoId, rating: Rating): Promise<void> => {
    const before = this.#ratingOf(videoId) ?? "none";
    const mine = this.#given.get(videoId) ?? { last: 0, settled: 0, pending: 0 };
    this.#given.set(videoId, mine);
    const stamp = ++this.#clock;
    mine.last = stamp;
    mine.pending++;
    this.learn(videoId, rating);
    try {
      await youtube.rate(videoId, rating);
    } catch (error) {
      if (mine.last === stamp) this.learn(videoId, before);
      throw error;
    } finally {
      mine.pending--;
      mine.settled = ++this.#clock;
    }
  };
}

/**
 * Ratings for the signed-in account: what is known, a way to record what
 * YouTube says, and a way to rate. Signed out there is nothing to know.
 */
export function useRatings(account: string | null) {
  const [store, setStore] = useState(() => new RatingStore(account));
  if (store.account !== account) setStore(new RatingStore(account));
  useEffect(() => store.attach(), [store]);
  const ratingOf = useSyncExternalStore(store.subscribe, store.getRatingOf);
  return { ratingOf, learn: store.learn, now: store.now, rate: store.rate };
}
