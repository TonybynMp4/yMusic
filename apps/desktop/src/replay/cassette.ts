/**
 * The format shared by recording and replay (see docs/replay.md).
 *
 * A cassette is a folder of entries, one JSON file per IPC call, numbered in
 * the order the calls finished. `http_fetch` is one IPC call like any other,
 * so YouTube's answers and the Rust core's sit on one timeline.
 *
 * Nothing that can sign in is written: request headers are dropped, response
 * cookies are dropped, and any session the Rust core hands back keeps its
 * cookie names with every value replaced.
 */

import { fromBase64, toBase64 } from "./browser.ts";

export interface HttpExchange {
  method: string;
  url: string;
  status: number;
  statusText: string;
  /** The URL after redirects, as `Response.url` reports it. */
  finalUrl: string;
  headers: [string, string][];
  body: string;
  encoding: "utf8" | "base64";
}

export interface Entry {
  /** Position on the recording's timeline, from 1. */
  seq: number;
  cmd: string;
  /** What replay matches a call on. See `httpKey` and `commandKey`. */
  key: string;
  /** Absent for `http_fetch`, whose arguments are a binary frame. */
  args?: unknown;
  /** Exactly one of `result`, `error` or `http` is set. */
  result?: unknown;
  error?: unknown;
  http?: HttpExchange;
}

/** Commands whose answer is a session cookie, or null. */
export const SESSION_COMMANDS = new Set([
  "account_cookie",
  "account_sign_in",
  "account_import",
  "account_refresh",
  "account_rotate",
]);

/** The value every cookie gets in a cassette. */
const SCRUBBED = "replay";

/** Keeps the cookie names, so the engine still sees a signed-in session. */
export function scrubCookie(cookie: string): string {
  return cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const at = part.indexOf("=");
      return at === -1 ? part : `${part.slice(0, at)}=${SCRUBBED}`;
    })
    .join("; ");
}

/** Response headers that would leak a session, or no longer describe the body. */
const DROPPED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "set-cookie2",
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);

export function keptResponseHeaders(headers: [string, string][]): [string, string][] {
  return headers.filter(([name]) => !DROPPED_RESPONSE_HEADERS.has(name.toLowerCase()));
}

/** Query parameters that change between runs without changing the answer. */
const VOLATILE_QUERY = new Set(["key", "t", "cpn", "rn", "rt", "prettyPrint", "alt"]);

/**
 * Body fields that change between runs without changing the answer: the
 * client context (versions, visitor data, timestamps), playback nonces and
 * tokens, and click tracking.
 */
const VOLATILE_FIELDS = new Set([
  "context",
  "cpn",
  "playbackContext",
  "serviceIntegrityDimensions",
  "attestationRequest",
  "clickTracking",
  "clickTrackingParams",
]);

/**
 * What a recorded YouTube request is matched on: the method, the host and
 * path, the stable query parameters, and the body without its volatile
 * fields. A body that is not JSON (an image upload, BotGuard's protobuf) is
 * matched on its length.
 */
export function httpKey(method: string, url: string, body: Uint8Array): string {
  const parsed = new URL(url);
  const query = [...parsed.searchParams]
    .filter(([name]) => !VOLATILE_QUERY.has(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  let shape = "";
  if (body.length > 0) {
    const text = new TextDecoder().decode(body);
    try {
      shape = stableJson(withoutFields(JSON.parse(text), VOLATILE_FIELDS));
    } catch {
      shape = `<${body.length} bytes>`;
    }
  }
  const target = `${parsed.host}${parsed.pathname}${query === "" ? "" : `?${query}`}`;
  return [method.toUpperCase(), target, shape].filter((part) => part !== "").join(" ");
}

/**
 * What any other command is matched on: its name and its arguments. A
 * channel serializes as `__CHANNEL__:<id>`, whose id differs every run, so
 * it is reduced to `__CHANNEL__`.
 */
export function commandKey(cmd: string, args: unknown): string {
  const shape = stableJson(args ?? null).replace(/__CHANNEL__:\d+/g, "__CHANNEL__");
  return shape === "null" || shape === "{}" ? cmd : `${cmd} ${shape}`;
}

function withoutFields(value: unknown, fields: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutFields(item, fields));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => !fields.has(name))
      .map(([name, item]) => [name, withoutFields(item, fields)]),
  );
}

/** JSON with object keys sorted, so two equal values give one string. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
}

/** Text when the body is valid UTF-8, base64 otherwise. */
export function encodeBody(body: Uint8Array): Pick<HttpExchange, "body" | "encoding"> {
  try {
    return { body: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: "utf8" };
  } catch {
    return { body: toBase64(body), encoding: "base64" };
  }
}

export function decodeBody(exchange: Pick<HttpExchange, "body" | "encoding">): Uint8Array {
  if (exchange.encoding === "utf8") return new TextEncoder().encode(exchange.body);
  return fromBase64(exchange.body);
}

/**
 * Answers calls from a recording, following its order.
 *
 * A key recorded more than once (a playlist loaded, edited, then loaded
 * again) moves on to its next answer only once something recorded between
 * the two has been replayed. So a page loaded after a replayed edit shows
 * the edit, and refetching it before the edit keeps showing it as it was.
 */
export class Timeline {
  readonly #byKey = new Map<string, Entry[]>();
  readonly #replayed: number[] = [];

  constructor(entries: Entry[]) {
    for (const entry of [...entries].sort((a, b) => a.seq - b.seq)) {
      push(this.#byKey, entry.key, entry);
    }
  }

  find(key: string): Entry | undefined {
    const entries = this.#byKey.get(key);
    if (entries === undefined) return undefined;
    let at = 0;
    while (
      at + 1 < entries.length &&
      this.#replayedBetween(entries[at]!.seq, entries[at + 1]!.seq)
    ) {
      at++;
    }
    const entry = entries[at]!;
    this.#replayed.push(entry.seq);
    return entry;
  }

  #replayedBetween(after: number, before: number): boolean {
    return this.#replayed.some((seq) => seq > after && seq < before);
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
