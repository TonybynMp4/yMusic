/**
 * Records every IPC call into a cassette, through the dev server.
 *
 * Inside the app (`pnpm record`) it wraps Tauri's own IPC, so the answers are
 * the real core's and YouTube's for whatever account is signed in. In a
 * plain browser (`pnpm record:browser`) the dev server sends YouTube's
 * requests from Node instead, signed out, and only those are recorded.
 */

// Must stay the first import: see internals.ts.
import { handleIpc, mocked } from "./internals.ts";

import { decodeFrame, encodeFrame } from "@ymusic/ipc";

import { browserAnswer, fromBase64, toBase64, type WireResponse } from "./browser.ts";
import {
  commandKey,
  encodeBody,
  httpKey,
  keptResponseHeaders,
  scrubCookie,
  SESSION_COMMANDS,
  type Entry,
} from "./cassette.ts";

interface RequestHead {
  method: string;
  url: string;
  headers: [string, string][];
}

interface ResponseHead {
  status: number;
  statusText: string;
  url: string;
  headers: [string, string][];
}

if (mocked)
  handleIpc((cmd, args) => (cmd === "http_fetch" ? live(args) : browserAnswer(cmd, args)));

const internals = window.__TAURI_INTERNALS__;
const invoke = internals.invoke.bind(internals);
internals.invoke = async (cmd, args, options) => {
  try {
    const result = await invoke(cmd, args, options);
    record(cmd, args, { result });
    return result;
  } catch (error: unknown) {
    record(cmd, args, { error });
    throw error;
  }
};

console.info(`recording IPC into a cassette${mocked ? ", signed out through the dev server" : ""}`);

/** Sends one request the way `http_fetch` would, from the dev server. */
async function live(args: unknown): Promise<ArrayBuffer> {
  const { head, body } = decodeFrame<RequestHead>(new Uint8Array(args as ArrayBuffer));
  const response = await fetch("/__replay/fetch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...head, body: toBase64(body) }),
  });
  if (!response.ok) throw new Error(await response.text());
  const answer = (await response.json()) as WireResponse;
  const { body: answerBody, ...answerHead } = answer;
  return encodeFrame(answerHead, fromBase64(answerBody)).buffer;
}

function record(cmd: string, args: unknown, outcome: { result?: unknown; error?: unknown }): void {
  // Event listeners are callback ids for this page only.
  if (cmd.startsWith("plugin:event|")) return;
  let entry: Omit<Entry, "seq">;
  if (cmd === "http_fetch") {
    if (outcome.result === undefined) {
      entry = { cmd, key: httpRequestKey(args), error: String(outcome.error) };
    } else {
      entry = { cmd, key: httpRequestKey(args), http: exchange(args, outcome.result) };
    }
  } else {
    if (mocked) return;
    const plain = JSON.parse(JSON.stringify(args ?? null)) as unknown;
    const result = SESSION_COMMANDS.has(cmd) ? scrubSession(outcome.result) : outcome.result;
    entry = {
      cmd,
      key: commandKey(cmd, plain),
      args: plain,
      ...("error" in outcome ? { error: String(outcome.error) } : { result: result ?? null }),
    };
  }
  void fetch("/__replay/record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(entry),
  }).catch((error: unknown) => console.error("could not record", cmd, error));
}

function httpRequestKey(args: unknown): string {
  const { head, body } = decodeFrame<RequestHead>(new Uint8Array(args as ArrayBuffer));
  return httpKey(head.method, head.url, body);
}

function exchange(args: unknown, result: unknown): NonNullable<Entry["http"]> {
  const request = decodeFrame<RequestHead>(new Uint8Array(args as ArrayBuffer)).head;
  const { head, body } = decodeFrame<ResponseHead>(new Uint8Array(result as ArrayBuffer));
  return {
    method: request.method,
    url: request.url,
    status: head.status,
    statusText: head.statusText,
    finalUrl: head.url,
    headers: keptResponseHeaders(head.headers),
    ...encodeBody(body),
  };
}

function scrubSession(result: unknown): unknown {
  return typeof result === "string" ? scrubCookie(result) : result;
}
