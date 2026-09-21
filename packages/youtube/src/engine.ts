import type { StreamLease, Track, VideoId } from "@ytbm/core";
import type { Innertube } from "youtubei.js";

import { createPlayer, createYouTube, type FetchLike } from "./client.ts";
import { searchSongs } from "./search.ts";
import { resolveStream } from "./stream.ts";

/**
 * Everything the app asks of YouTube, behind one object.
 *
 * It is the unit that runs in the worker, so its methods take and return only
 * structured-cloneable values — ids, strings, `Track`s, leases — never a
 * youtubei.js object. That rule is what keeps the worker boundary a detail:
 * the same class runs on the main thread in tests with nothing changed.
 */
export class YouTubeEngine {
  readonly #fetch: FetchLike;
  #browse: Promise<Innertube> | null = null;
  #player: Promise<Innertube> | null = null;

  constructor(fetch: FetchLike) {
    this.#fetch = fetch;
  }

  async search(query: string): Promise<Track[]> {
    return searchSongs(await this.#browseClient(), query);
  }

  async resolve(videoId: VideoId): Promise<StreamLease> {
    return resolveStream(await this.#playerClient(), videoId);
  }

  /**
   * Created once: `Innertube.create` is a network round trip for session
   * context, so one per search would cost more than the search.
   */
  #browseClient(): Promise<Innertube> {
    this.#browse ??= retryable(createYouTube({ fetch: this.#fetch }), () => {
      this.#browse = null;
    });
    return this.#browse;
  }

  /**
   * Also created once, and more importantly so: it downloads and interprets
   * YouTube's player JavaScript, the slowest step on the whole path. Held as a
   * promise so two tracks resolving together share one creation.
   */
  #playerClient(): Promise<Innertube> {
    this.#player ??= retryable(createPlayer({ fetch: this.#fetch }), () => {
      this.#player = null;
    });
    return this.#player;
  }
}

/**
 * A rejected creation left cached would be reused forever, so one failed
 * startup — offline for a moment, say — would break the engine for the rest of
 * the run. Forget it on failure and let the next call try again.
 */
function retryable<T>(promise: Promise<T>, forget: () => void): Promise<T> {
  return promise.catch((error: unknown) => {
    forget();
    throw error;
  });
}
