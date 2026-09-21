import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { VideoId } from "@ymusic/core";

import { YouTubeEngine } from "./engine.ts";
import type { BotGuardVm } from "./po-token.ts";

/**
 * The fallback path end to end: `botguard/frame.js`, the very file the app
 * serves into its isolated frame, runs BotGuard in jsdom, the engine mints
 * with it, and the resulting stream has to answer mpv's request. The 206 at
 * the end is the only thing that proves the token was accepted; a URL that
 * merely resolves proves nothing.
 *
 * Network-gated like `live.test.ts`; run with `YMUSIC_NETWORK_TESTS=1`.
 */
const live = process.env.YMUSIC_NETWORK_TESTS === "1" ? describe : describe.skip;

function frameVm(): BotGuardVm {
  const dom = new JSDOM("<!doctype html>", { runScripts: "outside-only" });
  // jsdom's one gap that frame.js falls into; every browser has it. Bytes come
  // back as the window's own Uint8Array so `instanceof` checks in there hold.
  const window = dom.window as unknown as typeof globalThis;
  window.TextEncoder = class extends TextEncoder {
    override encode(input?: string) {
      return new window.Uint8Array(super.encode(input)) as Uint8Array<ArrayBuffer>;
    }
  };
  // One eval, ending in the name: the file is strict, so its top-level `const`
  // lives in that eval's own scope and a second eval could not see it.
  const source = readFileSync(new URL("../botguard/frame.js", import.meta.url), "utf8");
  const vm = dom.window.eval(`${source}\n;botguard`) as {
    load(args: unknown): Promise<string>;
    createMinter(args: unknown): Promise<void>;
    mint(args: unknown): Promise<string>;
  };
  // Same argument shapes the frame's MessagePort transport passes through.
  return {
    load: (challenge) => vm.load(challenge),
    createMinter: (integrityToken) => vm.createMinter({ integrityToken }),
    mint: (binding) => vm.mint({ binding }),
  };
}

live("the PO-token fallback", () => {
  it("resolves a stream that answers mpv's range request", { timeout: 90_000 }, async () => {
    const engine = new YouTubeEngine(globalThis.fetch, frameVm());
    const lease = await engine.resolve("SM4tQcUt_mQ" as VideoId, { fallback: true });

    const url = new URL(lease.url);
    expect(url.searchParams.get("c")).toBe("TVHTML5_SIMPLY");
    expect(url.searchParams.get("pot")).toBeTruthy();

    const status = async (target: URL) => {
      const response = await fetch(target, { headers: { Range: "bytes=0-" } });
      await response.body?.cancel();
      return response.status;
    };
    expect(await status(url)).toBe(206);
    // And the token is what did it: the same URL without one is refused.
    url.searchParams.delete("pot");
    expect(await status(url)).toBe(403);
  });
});
