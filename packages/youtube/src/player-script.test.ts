import { expose, type Endpoint } from "comlink";
import { describe, expect, it } from "vitest";
import { Platform } from "youtubei.js";

import { playerEvaluator } from "./client.ts";
import type { ExtractorApi } from "./extractor.ts";
import { extractInWorker, type ExtractorWorker } from "./host.ts";
import { playerFrom } from "./player-extract.ts";
import { currentPlayerId, type PlayerScript } from "./player-script.ts";

/**
 * Stands in for what youtubei.js extracts: an `nsigFunction` that builds a
 * URL object whose methods, once all called, leave `n` reversed and the
 * signature upper-cased. youtubei.js's own `process()` does the calling.
 */
const script: PlayerScript = {
  playerId: "abc123",
  signatureTimestamp: 20000,
  data: {
    output: `var exportedVars = {
      nsigFunction(url, sp, s) {
        const params = new Map([["n", new URL(url).searchParams.get("n")], [sp, s]]);
        return new (class {
          get(key) { return params.get(key); }
          transform() {
            params.set("n", [...params.get("n")].reverse().join(""));
            if (s) params.set(sp, s.toUpperCase());
          }
        })();
      },
    };`,
    exported: ["nsigFunction"],
    exportedRawValues: {},
  },
};

describe("deciphering with an analysed player script", () => {
  Platform.shim.eval = playerEvaluator();

  it("transforms n", async () => {
    const url = await playerFrom(script).decipher("https://rr1.googlevideo.com/videoplayback?n=abc");
    expect(new URL(url).searchParams.get("n")).toBe("cba");
  });

  it("transforms the signature into the parameter sp names", async () => {
    const stream = encodeURIComponent("https://rr1.googlevideo.com/videoplayback?n=abc");
    const url = new URL(await playerFrom(script).decipher(undefined, `s=xyz&sp=sig&url=${stream}`));
    expect(url.searchParams.get("sig")).toBe("XYZ");
    expect(url.searchParams.get("n")).toBe("cba");
  });

  it("adds the PO token of the client it belongs to", async () => {
    const url = await playerFrom(script, "token").decipher("https://rr1.googlevideo.com/videoplayback?n=abc");
    expect(new URL(url).searchParams.get("pot")).toBe("token");
  });
});

it("reads the current player id from the iframe API", async () => {
  const iframeApi = String.raw`var scriptUrl = 'https:\/\/www.youtube.com\/s\/player\/0c96dfd3\/www-widgetapi.vflset\/www-widgetapi.js';`;
  expect(await currentPlayerId(async () => new Response(iframeApi))).toBe("0c96dfd3");
});

describe("analysing in a worker", () => {
  function memoryStorage(): Storage {
    const items = new Map<string, string>();
    return {
      get length() {
        return items.size;
      },
      clear: () => items.clear(),
      getItem: (key) => items.get(key) ?? null,
      key: (index) => [...items.keys()][index] ?? null,
      removeItem: (key) => void items.delete(key),
      setItem: (key, value) => void items.set(key, value),
    };
  }

  function setup() {
    const counts = { downloads: 0, workers: 0, ended: 0 };
    const fetch: typeof globalThis.fetch = async () => {
      counts.downloads += 1;
      return new Response("base.js");
    };
    const startWorker = (): ExtractorWorker => {
      counts.workers += 1;
      const { port1, port2 } = new MessageChannel();
      const api: ExtractorApi = {
        extract: async (playerId) => ({ ...script, playerId }),
      };
      expose(api, port1 as Endpoint);
      return Object.assign(port2, {
        terminate: () => {
          counts.ended += 1;
          port1.close();
          port2.close();
        },
      });
    };
    return { counts, source: extractInWorker(fetch, startWorker, memoryStorage()) };
  }

  it("ends the worker once it has the script", async () => {
    const { counts, source } = setup();
    expect((await source("abc123", "18.1.0")).playerId).toBe("abc123");
    expect(counts).toEqual({ downloads: 1, workers: 1, ended: 1 });
  });

  it("keeps the script for the same player and library", async () => {
    const { counts, source } = setup();
    await source("abc123", "18.1.0");
    expect(await source("abc123", "18.1.0")).toEqual(script);
    expect(counts.workers).toBe(1);
  });

  it("analyses again for a new player or library version", async () => {
    const { counts, source } = setup();
    await source("abc123", "18.1.0");
    await source("def456", "18.1.0");
    await source("def456", "18.2.0");
    expect(counts.workers).toBe(3);
  });
});
