import { Innertube } from "youtubei.js";

export type FetchLike = typeof fetch;

export interface YouTubeOptions {
  /**
   * How InnerTube is reached.
   *
   * Required rather than defaulted, because the default is wrong in the place
   * this actually runs: YouTube's endpoints send no CORS headers, so the
   * webview's own `fetch` is blocked before the request leaves. The desktop app
   * passes a fetch that goes out through Rust. Node (tests, probes) passes the
   * global one.
   */
  fetch: FetchLike;
}

/**
 * An InnerTube client for read-only browsing.
 *
 * `retrieve_player: false` skips downloading and interpreting YouTube's player
 * JavaScript. Search does not need it, and it is the slowest and most brittle
 * part of startup, so nothing that only reads metadata should pay for it. Stream
 * resolution will need a client that does.
 */
export async function createYouTube(options: YouTubeOptions): Promise<Innertube> {
  return Innertube.create({
    retrieve_player: false,
    fetch: options.fetch,
  });
}
