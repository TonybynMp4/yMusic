import { isTauri } from "./tauri.ts";

/**
 * The origin InnerTube is told the request came from.
 *
 * `www.youtube.com` and not `music.youtube.com`, even though this app is a
 * music client: YouTube Music search posts to `www.youtube.com` and differs
 * only by the client context in the body, and `/youtubei/v1/config` answers
 * 400 when the origin disagrees with the host it was sent to. Measured: of
 * `tauri.localhost`, `music.youtube.com` and this, only this is 200 on both
 * `/config` and `/search`.
 */
const YOUTUBE_ORIGIN = "https://www.youtube.com";

/**
 * The headers to send instead of the ones the webview would attach.
 *
 * A request from the app's page is cross-origin to YouTube, so it would be
 * labelled `Origin: http://tauri.localhost`, an origin YouTube does not know,
 * and answered with 403. Overriding both headers makes the request look
 * like what it is in every way that matters to the server.
 *
 * Both arguments are merged, in the order `fetch` itself would: a caller that
 * passes a `Request` carrying InnerTube's client headers and no `init` must
 * keep those headers.
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
  // An explicitly empty Origin means "send none", which `http_fetch` honours by
  // dropping the header. BotGuard's challenge is bound to the requesting
  // origin and refused later if that was YouTube's, so it asks for this.
  if (headers.get("Origin") === "") {
    headers.delete("Referer");
    return headers;
  }
  headers.set("Origin", YOUTUBE_ORIGIN);
  headers.set("Referer", `${YOUTUBE_ORIGIN}/`);
  return headers;
}

/**
 * The fetch that reaches YouTube.
 *
 * InnerTube sends no CORS headers, so the webview's own `fetch` never gets the
 * response: the request is blocked as a cross-origin read before anything
 * comes back. The `http_fetch` command performs it in Rust instead, over one
 * pooled client, and only for YouTube's hosts (`src-tauri/src/http.rs`), so
 * this is not a general-purpose hole.
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
  const request = input instanceof Request ? input : null;
  let body = new Uint8Array();
  if (init?.body != null) body = new Uint8Array(await new Response(init.body).arrayBuffer());
  else if (request?.body) body = new Uint8Array(await request.arrayBuffer());

  const { invoke } = await import("@tauri-apps/api/core");
  const frame = await invoke<ArrayBuffer>(
    "http_fetch",
    encodeFrame(
      {
        method: init?.method ?? request?.method ?? "GET",
        url: request ? request.url : input.toString(),
        headers: [...youtubeHeaders(input, init)],
      },
      body,
    ),
  );
  const { head, body: responseBody } = decodeFrame<ResponseHead>(new Uint8Array(frame));
  const response = new Response(NULL_BODY_STATUSES.has(head.status) ? null : responseBody, {
    status: head.status,
    statusText: head.statusText,
    headers: head.headers,
  });
  // A constructed Response has an empty `url`; callers that resolve redirects
  // or relative links against it need the real one.
  Object.defineProperty(response, "url", { value: head.url });
  return response;
}

interface ResponseHead {
  status: number;
  statusText: string;
  url: string;
  headers: [string, string][];
}

/** Statuses whose responses may not carry a body; `new Response` throws otherwise. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Both directions of `http_fetch` are one buffer: a little-endian `u32`
 * length, that many bytes of JSON, then the body. Raw bytes cross the IPC as
 * they are, where a JSON array of numbers would be several times the size.
 */
export function encodeFrame(head: unknown, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(head));
  const frame = new Uint8Array(4 + json.length + body.length);
  new DataView(frame.buffer).setUint32(0, json.length, true);
  frame.set(json, 4);
  frame.set(body, 4 + json.length);
  return frame;
}

export function decodeFrame<T>(frame: Uint8Array): { head: T; body: Uint8Array<ArrayBuffer> } {
  const length = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(frame.subarray(4, 4 + length))) as T;
  return { head, body: frame.slice(4 + length) };
}
