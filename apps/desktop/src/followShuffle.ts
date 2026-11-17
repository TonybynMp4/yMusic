import type { Track } from "@ymusic/core";

/** A page of YouTube Music's shuffle, and the token for the next, if any. */
export interface ShufflePage {
  tracks: Track[];
  more: string | null;
}

/**
 * Pages of YouTube Music's shuffle to follow at most: 5,000 songs, the most a
 * playlist holds. Only a guard against a server that never stops paging.
 */
const MAX_SHUFFLE_PAGES = 100;

/** Why following stopped, for tests and logs. */
export type ShuffleEnd = "end" | "limit" | "failed" | "stopped";

/**
 * Follows YouTube Music's shuffle on from its first page, handing `onPage`
 * each later page as it is, in the server's order. An empty page or the last
 * token ends it, and a failed page ends it with what came so far.
 */
export async function followShuffle(
  first: ShufflePage,
  options: {
    more: (token: string) => Promise<ShufflePage>;
    onPage: (tracks: Track[]) => void;
    stopped: () => boolean;
    maxPages?: number;
  },
): Promise<ShuffleEnd> {
  const { more, onPage, stopped, maxPages = MAX_SHUFFLE_PAGES } = options;
  let token = first.more;
  for (let page = 1; token !== null; page++) {
    if (stopped()) return "stopped";
    if (page >= maxPages) return "limit";
    let next: ShufflePage;
    try {
      next = await more(token);
    } catch (error) {
      console.error("could not get more of YouTube Music's shuffle", error);
      return "failed";
    }
    if (stopped()) return "stopped";
    if (next.tracks.length === 0) return "end";
    onPage(next.tracks);
    token = next.more;
  }
  return "end";
}
