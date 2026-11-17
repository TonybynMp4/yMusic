import type { Track } from "@ymusic/core";

/** A page of YouTube Music's shuffle, and the token for the next, if any. */
export interface ShufflePage {
  tracks: Track[];
  more: string | null;
}

/** Pages of YouTube Music's shuffle to follow at most, about two thousand songs. */
const MAX_SHUFFLE_PAGES = 40;

/** Why following stopped, for tests and logs. */
export type ShuffleEnd = "end" | "repeats" | "limit" | "failed" | "stopped";

/**
 * Follows YouTube Music's shuffle on from its first page, handing `onPage`
 * each later page's new songs. The server draws with replacement, so a song
 * already seen is dropped (`radioFrom` already drops one repeated within a
 * page), and a page of nothing but repeats means it has run out of new ones.
 * A failed page ends it with what came so far.
 */
export async function followShuffle(
  first: ShufflePage,
  options: {
    more: (token: string) => Promise<ShufflePage>;
    onPage: (added: Track[]) => void;
    stopped: () => boolean;
    maxPages?: number;
  },
): Promise<ShuffleEnd> {
  const { more, onPage, stopped, maxPages = MAX_SHUFFLE_PAGES } = options;
  const seen = new Set(first.tracks.map((t) => t.id));
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
    const added = next.tracks.filter((t) => !seen.has(t.id));
    if (added.length === 0) return "repeats";
    for (const t of added) seen.add(t.id);
    onPage(added);
    token = next.more;
  }
  return "end";
}
