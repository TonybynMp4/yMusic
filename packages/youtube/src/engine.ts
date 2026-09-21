import type { StreamLease, Track, VideoId } from "@ytbm/core";
import type { Innertube } from "youtubei.js";

import { createPlayer, createYouTube, type FetchLike } from "./client.ts";
import { searchSongs } from "./search.ts";
import { resolveStream } from "./stream.ts";

/** Who is signed in, as far as the UI needs to show it. */
export interface AccountSummary {
  name: string;
  handle: string | null;
  photoUrl: string | null;
}

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
  #cookie: string | null = null;
  #browse: Promise<Innertube> | null = null;
  #player: Promise<Innertube> | null = null;

  constructor(fetch: FetchLike) {
    this.#fetch = fetch;
  }

  /**
   * Signs the browsing client in or out. Only that client: the player client
   * impersonates VISIONOS, and a web session's cookie on a non-web client is
   * exactly the mismatch YouTube flags, so playback stays anonymous — it
   * needs no account for anything the app plays today.
   */
  setCookie(cookie: string | null): void {
    if (cookie === this.#cookie) return;
    this.#cookie = cookie;
    this.#browse = null;
  }

  /** None when signed out. Rejects when the saved session has expired. */
  async account(): Promise<AccountSummary | null> {
    if (this.#cookie === null) return null;
    const accounts = await (await this.#browseClient()).account.getInfo(true);
    const active = accounts.find((a) => a.is_selected) ?? accounts[0];
    if (!active) throw new Error("YouTube did not accept the saved session");
    const handle = active.channel_handle?.toString() ?? "";
    return {
      name: active.account_name.toString(),
      handle: handle.length > 0 ? handle : null,
      photoUrl: largestPhoto(active.account_photo),
    };
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
    this.#browse ??= retryable(createYouTube({ fetch: this.#fetch, cookie: this.#cookie ?? undefined }), () => {
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

/** Account photos arrive protocol-relative (`//yt3.ggpht.com/...`) at times. */
function largestPhoto(photos: readonly { url: string; width: number }[]): string | null {
  const largest = photos.reduce<{ url: string; width: number } | null>(
    (best, photo) => (best === null || photo.width > best.width ? photo : best),
    null,
  );
  if (!largest) return null;
  return largest.url.startsWith("//") ? `https:${largest.url}` : largest.url;
}
