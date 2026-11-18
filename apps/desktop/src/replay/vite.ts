/**
 * The dev server's half of recording and replay (see docs/replay.md).
 *
 * `YMUSIC_RECORD=<name>` loads `record.ts` before the app and writes what it
 * sends to the cassette. `YMUSIC_REPLAY=<name>` loads `replay.ts` instead and
 * serves the cassette to it. A name is a folder under
 * `$XDG_DATA_HOME/ymusic-dev/cassettes`, shared by every worktree; an
 * absolute path is used as it is.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { Plugin } from "vite";

import type { WireRequest, WireResponse } from "./browser.ts";
import type { Entry } from "./cassette.ts";

const ENTRY = /^\d{5}-.*\.json$/;

function cassetteDir(name: string): string {
  if (isAbsolute(name)) return name;
  const data = process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share");
  return join(data, "ymusic-dev", "cassettes", name);
}

export function replayPlugin(): Plugin | null {
  const recording = process.env["YMUSIC_RECORD"];
  const replaying = process.env["YMUSIC_REPLAY"];
  if (recording && replaying) throw new Error("set YMUSIC_RECORD or YMUSIC_REPLAY, not both");
  const name = recording || replaying;
  if (!name) return null;
  const dir = cassetteDir(name);
  const entry = recording ? "/src/replay/record.ts" : "/src/replay/replay.ts";

  return {
    name: "ymusic-replay",
    apply: "serve",
    transformIndexHtml: () => [
      { tag: "script", attrs: { type: "module", src: entry }, injectTo: "head-prepend" },
    ],
    configureServer(server) {
      const log = (line: string) => server.config.logger.info(line, { timestamp: true });
      if (recording) {
        // A recording starts from nothing, so replay never mixes two of them.
        mkdirSync(dir, { recursive: true });
        for (const file of readdirSync(dir)) if (ENTRY.test(file)) rmSync(join(dir, file));
        log(`recording into ${dir}`);
      } else {
        log(`replaying ${dir}`);
      }
      let seq = 0;
      const missed = new Set<string>();

      server.middlewares.use("/__replay", (req, res, next) => {
        void (async () => {
          if (recording && req.method === "POST" && req.url === "/record") {
            const saved = { seq: ++seq, ...(JSON.parse(await text(req)) as Omit<Entry, "seq">) };
            const slug = saved.cmd.replace(/[^a-z0-9]+/gi, "_");
            writeFileSync(join(dir, `${String(seq).padStart(5, "0")}-${slug}.json`), json(saved));
            log(`[record] ${String(seq).padStart(5, "0")} ${clip(saved.key)}`);
            return send(res, 204, "");
          }
          if (recording && req.method === "POST" && req.url === "/fetch") {
            return send(res, 200, JSON.stringify(await live(JSON.parse(await text(req)))));
          }
          if (replaying && req.method === "GET" && req.url === "/cassette") {
            return send(res, 200, JSON.stringify(readCassette(dir)));
          }
          if (replaying && req.method === "POST" && req.url === "/miss") {
            const key = await text(req);
            if (!missed.has(key)) server.config.logger.warn(`[replay] not recorded: ${clip(key)}`);
            missed.add(key);
            return send(res, 204, "");
          }
          next();
        })().catch((error: unknown) => send(res, 500, String(error)));
      });
    },
  };
}

function readCassette(dir: string): Entry[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => ENTRY.test(file));
  } catch {
    throw new Error(`no cassette at ${dir}: record one first (docs/replay.md)`);
  }
  return files.map((file) => {
    const entry = JSON.parse(readFileSync(join(dir, file), "utf8")) as Entry;
    const http = entry.http as (Entry["http"] & { json?: unknown }) | undefined;
    if (http && "json" in http) {
      const { json: parsed, ...rest } = http;
      entry.http = { ...rest, body: JSON.stringify(parsed) };
    }
    return entry;
  });
}

/**
 * Sends a request the way `http_fetch` does, for a browser recording signed
 * out. The browser has already set the headers `appFetch` sets; an empty
 * Origin means none, as `http_fetch` takes it.
 */
async function live(request: WireRequest): Promise<WireResponse> {
  const host = new URL(request.url).hostname;
  if (!/(^|\.)(youtube\.com|googlevideo\.com|google\.com|googleapis\.com)$/.test(host)) {
    throw new Error(`not a YouTube host: ${host}`);
  }
  const headers = new Headers(request.headers.filter(([, value]) => value !== ""));
  const body = Buffer.from(request.body, "base64");
  const response = await fetch(request.url, {
    method: request.method,
    headers,
    ...(body.length > 0 ? { body } : {}),
  });
  return {
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers: [...response.headers],
    body: Buffer.from(await response.arrayBuffer()).toString("base64"),
  };
}

async function text(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  if (body !== "") res.setHeader("content-type", "application/json");
  res.end(body);
}

/** Pretty-printed when the body is JSON, so a cassette reads in a diff. */
function json(entry: Entry): string {
  if (entry.http?.encoding === "utf8") {
    try {
      const parsed = JSON.parse(entry.http.body) as unknown;
      return `${JSON.stringify({ ...entry, http: { ...entry.http, body: undefined, json: parsed } }, null, 2)}\n`;
    } catch {
      // Not JSON: kept as text.
    }
  }
  return `${JSON.stringify(entry, null, 2)}\n`;
}

function clip(line: string): string {
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}
