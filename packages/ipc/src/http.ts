import { isTauri } from "./tauri.ts";

/**
 * The origin InnerTube is told the request came from.
 *
 * `www.youtube.com` and not `music.youtube.com`, even though this app is a
 * music client: YouTube Music search posts to `www.youtube.com` and differs
 * only by the client context in the body, and `/youtubei/v1/config` answers
 * 400 when the origin disagrees with the host it was sent to. Measured — of
 * `tauri.localhost`, `music.youtube.com` and this, only this is 200 on both
 * `/config` and `/search`.
 */
const YOUTUBE_ORIGIN = "https://www.youtube.com";

/**
 * The headers to send instead of the ones the webview would attach.
 *
 * A request from the app's page is cross-origin to YouTube, so the plugin
 * labels it `Origin: http://tauri.localhost` — an origin YouTube does not
 * know, and answers with 403. Overriding both headers makes the request look
 * like what it is in every way that matters to the server.
 *
 * Both arguments are merged, in the order `fetch` itself would: a caller that
 * passes a `Request` carrying InnerTube's client headers and no `init` must
 * keep those headers, since passing `init.headers` to the plugin replaces
 * rather than extends whatever the `Request` had.
 *
 * Split out from `appFetch` so the rule can be tested without a webview,
 * because the failure it prevents only appears inside one.
 */
export function youtubeHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  // Deliberately a standalone `Headers`: one taken from a `Request` carries the
  // spec's "request" guard, which silently drops `Origin` and `Referer` on set.
  const headers = new Headers();
  if (typeof input === "object" && "headers" in input) {
    for (const [name, value] of input.headers) headers.set(name, value);
  }
  for (const [name, value] of new Headers(init?.headers)) headers.set(name, value);
  headers.set("Origin", YOUTUBE_ORIGIN);
  headers.set("Referer", `${YOUTUBE_ORIGIN}/`);
  return headers;
}

/**
 * The fetch that reaches YouTube.
 *
 * InnerTube sends no CORS headers, so the webview's own `fetch` never gets the
 * response — the request is blocked as a cross-origin read before anything
 * comes back. Tauri's HTTP plugin performs the request in Rust instead, where
 * the same-origin policy does not apply, and it is scoped to the YouTube hosts
 * in `capabilities/default.json` so this is not a general-purpose hole.
 *
 * The plugin only honours the headers below because `src-tauri/Cargo.toml`
 * enables its `unsafe-headers` feature; without that it strips them and
 * restores the losing origin, so the two changes only work together.
 *
 * Outside the app webview it falls back to the platform fetch, which keeps
 * Node tests and probe scripts on exactly the same code path. Node sends no
 * `Origin` at all, which is why this gap was invisible until the app ran.
 */
export async function appFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!isTauri) return globalThis.fetch(input, init);
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  return tauriFetch(input, { ...init, headers: youtubeHeaders(input, init) });
}
