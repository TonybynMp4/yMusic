import { readFileSync } from "node:fs";

import type { BotGuardVm } from "../src/po-token.ts";

/**
 * BotGuard in jsdom, as `po-token.test.ts` runs it, for the fallback client.
 * The app runs it in a frame of its own, which this cannot stand in for: what
 * the frame costs WebKit is not measured here, only what the engine does
 * around it. Built on first use, so jsdom stays out of phases that never mint.
 */
export function lazyBotGuard(): BotGuardVm {
  let vm: BotGuardVm | null = null;
  const connected = async () => (vm ??= await jsdomVm());
  return {
    load: async (challenge) => (await connected()).load(challenge),
    createMinter: async (integrityToken) => (await connected()).createMinter(integrityToken),
    mint: async (binding) => (await connected()).mint(binding),
  };
}

async function jsdomVm(): Promise<BotGuardVm> {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html>", { runScripts: "outside-only" });
  // jsdom's one gap that frame.js falls into; every browser has it. Bytes come
  // back as the window's own Uint8Array so `instanceof` checks in there hold.
  const window = dom.window as unknown as typeof globalThis;
  window.TextEncoder = class extends TextEncoder {
    override encode(input?: string) {
      return new window.Uint8Array(super.encode(input)) as Uint8Array<ArrayBuffer>;
    }
  };
  const source = readFileSync(new URL("../botguard/frame.js", import.meta.url), "utf8");
  const vm = dom.window.eval(`${source}\n;botguard`) as {
    load(args: unknown): Promise<string>;
    createMinter(args: unknown): Promise<void>;
    mint(args: unknown): Promise<string>;
  };
  return {
    load: (challenge) => vm.load(challenge),
    createMinter: (integrityToken) => vm.createMinter({ integrityToken }),
    mint: (binding) => vm.mint({ binding }),
  };
}
