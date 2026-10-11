import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * YouTube's responses, recorded once and served back, so two branches parse
 * exactly the same bytes and a run needs no network.
 *
 * A recording is a folder: `index.json` lists each request's key and its
 * response, and each body sits beside it gzipped, named by its hash. Bodies
 * are read from disk when asked for rather than held, so the recording itself
 * does not show up in what is measured.
 */

interface Entry {
  key: string;
  url: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  /** File name of the gzipped body, or null for an empty one. */
  body: string | null;
}

/** Statuses whose responses may not carry a body; `new Response` throws otherwise. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Query parameters and body fields that change between two identical
 * requests. `context` carries the client version and visitor id, which come
 * from an earlier response and so match anyway, but also timestamps.
 */
const VOLATILE_PARAMS = ["t", "cpn", "_"];
const VOLATILE_FIELDS = ["context", "cpn"];

export interface Recording {
  fetch: typeof fetch;
  /**
   * Requests the recording lacked, in `replay` mode. Kept apart from the error
   * each one throws, because the engine's callers may catch that.
   */
  missing(): string[];
  save(): void;
}

/**
 * `replay` fails on any request the recording lacks, naming it. `record`
 * serves what the recording has and fetches and keeps the rest, so a branch
 * that makes a new request extends the recording rather than replacing it.
 * Identical requests get the same response.
 */
export function openRecording(dir: string, mode: "replay" | "record"): Recording {
  const indexPath = join(dir, "index.json");
  const entries: Entry[] = existsSync(indexPath)
    ? (JSON.parse(readFileSync(indexPath, "utf8")) as Entry[])
    : [];
  if (mode === "replay" && entries.length === 0) {
    throw new Error(`no recording in ${dir}; make one with --record`);
  }
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  let recorded = 0;
  const missing: string[] = [];
  // Signed out, YouTube hands out visitor cookies and expects them back, as
  // the app's HTTP client does with its jar.
  const jar = new Map<string, string>();

  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const body = await request.clone().text();
    const key = requestKey(request.method, request.url, body);

    const known = byKey.get(key);
    if (known) return responseFrom(dir, known);
    if (mode === "replay") {
      missing.push(key);
      throw new Error(`not in the recording: ${key}`);
    }

    const headers = new Headers(request.headers);
    if (!headers.has("cookie") && jar.size > 0) {
      headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
    }
    const response = await fetch(new Request(request, { headers }));
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!;
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const bytes = NULL_BODY_STATUSES.has(response.status)
      ? new Uint8Array()
      : new Uint8Array(await response.arrayBuffer());
    const entry: Entry = {
      key,
      url: response.url || request.url,
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers].filter(([name]) => name !== "set-cookie"),
      body: bytes.length > 0 ? saveBody(dir, bytes) : null,
    };
    entries.push(entry);
    byKey.set(key, entry);
    recorded++;
    return responseFrom(dir, entry);
  };

  return {
    fetch: fetchFn as typeof fetch,
    missing: () => missing,
    save() {
      if (recorded === 0) return;
      mkdirSync(dir, { recursive: true });
      writeFileSync(indexPath, JSON.stringify(entries, null, 1));
    },
  };
}

export function requestKey(method: string, url: string, body: string): string {
  const parsed = new URL(url);
  for (const name of VOLATILE_PARAMS) parsed.searchParams.delete(name);
  parsed.searchParams.sort();
  let shape = body;
  if (body.startsWith("{")) {
    const json = JSON.parse(body) as Record<string, unknown>;
    for (const field of VOLATILE_FIELDS) delete json[field];
    shape = JSON.stringify(sortKeys(json));
  }
  return `${method} ${parsed.toString()} ${shape}`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

function saveBody(dir: string, bytes: Uint8Array): string {
  const name = `${new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 32)}.gz`;
  const path = join(dir, name);
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, Bun.gzipSync(bytes));
  }
  return name;
}

function responseFrom(dir: string, entry: Entry): Response {
  const body =
    entry.body === null || NULL_BODY_STATUSES.has(entry.status)
      ? null
      : Bun.gunzipSync(readFileSync(join(dir, entry.body)));
  const response = new Response(body, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
  });
  // A constructed Response has an empty `url`; youtubei.js resolves against it.
  Object.defineProperty(response, "url", { value: entry.url });
  return response;
}
