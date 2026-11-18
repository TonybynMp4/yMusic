/**
 * Answers every IPC call from a cassette, so the app runs in a plain
 * browser with no core, no account and no network (`pnpm dev:replay`).
 *
 * A YouTube request that was never recorded fails, and is reported to the
 * dev server's terminal and kept in `window.__replayMisses`, so an agent
 * can tell a missing recording from a broken page.
 */

// Must stay the first import: see internals.ts.
import { handleIpc, mocked } from "./internals.ts";

import { decodeFrame, encodeFrame } from "@ymusic/ipc";

import type { Settings } from "@ymusic/ipc";

import { browserAnswer, seedSettings } from "./browser.ts";
import { commandKey, decodeBody, httpKey, Timeline, type Entry } from "./cassette.ts";

declare global {
  interface Window {
    __replayMisses: string[];
  }
}

if (!mocked) throw new Error("replay runs in a plain browser, not in the app");

window.__replayMisses = [];
const timeline = fetch("/__replay/cassette")
  .then((response) => response.json() as Promise<Entry[]>)
  .then((entries) => {
    console.info(`replaying ${entries.length} recorded calls`);
    // Settings stay live in the tab, starting from the recorded ones, so a
    // toggle changes what the page shows as it would in the app.
    const settings = entries.findLast((entry) => entry.cmd === "settings_get");
    if (settings?.result) seedSettings(settings.result as Settings);
    return new Timeline(entries);
  });

handleIpc(async (cmd, args) => {
  const recorded = await timeline;
  if (cmd === "http_fetch") {
    const { head, body } = decodeFrame<{ method: string; url: string }>(
      new Uint8Array(args as ArrayBuffer),
    );
    const key = httpKey(head.method, head.url, body);
    const entry = recorded.find(key);
    if (entry === undefined) return miss(key);
    if (entry.http === undefined) throw new Error(String(entry.error));
    const { http } = entry;
    return encodeFrame(
      {
        status: http.status,
        statusText: http.statusText,
        url: http.finalUrl,
        headers: http.headers,
      },
      decodeBody(http),
    ).buffer;
  }
  if (cmd === "settings_get" || cmd === "settings_set") return browserAnswer(cmd, args);
  const plain = JSON.parse(JSON.stringify(args ?? null)) as unknown;
  const entry = recorded.find(commandKey(cmd, plain));
  if (entry === undefined) return browserAnswer(cmd, args);
  if ("error" in entry) throw new Error(String(entry.error));
  return entry.result;
});

function miss(key: string): never {
  window.__replayMisses.push(key);
  void fetch("/__replay/miss", { method: "POST", body: key });
  throw new Error(`replay: nothing recorded for ${key}`);
}
