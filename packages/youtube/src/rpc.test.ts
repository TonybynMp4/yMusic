import { describe, expect, it, vi } from "vitest";
import type { VideoId } from "@ymusic/core";

import { YouTubeEngine } from "./engine.ts";
import { exposeExtractor } from "./extractor.ts";
import { LIBRARY_VERSION } from "./player-extract.ts";
import { currentPlayerId } from "./player-script.ts";
import { connectEngine, extractInWorker, type ExtractorWorker } from "./host.ts";
import { live, unlessBotChecked } from "./live.ts";
import { exposeEngine } from "./worker.ts";

describe("the worker's forwarding", () => {
  // Each forwarder names its arguments, so one that drops an optional argument
  // still typechecks. Pausing search history once went missing that way.
  it("passes search options through to the engine", async () => {
    const search = vi.spyOn(YouTubeEngine.prototype, "search")
      .mockResolvedValue({ results: { top: null, shelves: [], filters: [] }, more: null });
    const { port1, port2 } = new MessageChannel();
    exposeEngine(port1);
    const engine = connectEngine(port2, globalThis.fetch);

    await engine.search("anything", { signedOut: true, filter: "videos" });
    expect(search).toHaveBeenCalledWith("anything", { signedOut: true, filter: "videos" });

    search.mockRestore();
    port1.close();
    port2.close();
  });
});

/**
 * The engine exactly as the app runs it (Comlink on one side, the fetch bridge
 * on the other), but over a `MessageChannel` in one process instead of a Worker.
 * Every request crosses the port twice, so a body that fails to transfer or a
 * header that gets dropped breaks this the same way it would break the app.
 *
 * Network-gated like `live.test.ts`; run with `YMUSIC_NETWORK_TESTS=1`.
 */
live("the engine across a message port", () => {
  it("searches and resolves a stream", { timeout: 60_000 }, async (context) => {
    const { port1, port2 } = new MessageChannel();
    exposeEngine(port1);
    let requests = 0;
    let extractors = 0;
    const fetch: typeof globalThis.fetch = (input, init) => {
      requests += 1;
      return globalThis.fetch(input, init);
    };
    // The player script is analysed on the host's side, as the app does it.
    const startExtractor = (): ExtractorWorker => {
      extractors += 1;
      const channel = new MessageChannel();
      exposeExtractor(channel.port1);
      return Object.assign(channel.port2, {
        terminate: () => {
          channel.port1.close();
          channel.port2.close();
        },
      });
    };
    const playerScript = extractInWorker(fetch, startExtractor);
    const engine = connectEngine(port2, fetch, { playerScript });

    const { results } = await engine.search("boards of canada roygbiv", { filter: "songs" });
    const tracks = results.shelves.flatMap((shelf) => (shelf.kind === "tracks" ? shelf.tracks : []));
    expect(tracks.length).toBeGreaterThan(0);
    // The requests really went through the host, not around it.
    expect(requests).toBeGreaterThan(0);

    const first = tracks[0]!;
    const lease = await unlessBotChecked(
      context,
      engine.resolve(first.id.slice("yt:".length) as VideoId),
    );
    expect(lease.trackId).toBe(first.id);
    expect(lease.url).toMatch(/^https:\/\/.*googlevideo\.com\//);
    // `VISIONOS` URLs need nothing deciphered, so no script was analysed.
    expect(extractors).toBe(0);

    // The signed-in and fallback clients do need it.
    const script = await playerScript(await currentPlayerId(fetch), LIBRARY_VERSION);
    expect(script.signatureTimestamp).toBeGreaterThan(0);
    expect(script.data.exported.length).toBeGreaterThan(0);
    expect(extractors).toBe(1);

    port1.close();
    port2.close();
  });

  it("carries errors back with their message", { timeout: 60_000 }, async () => {
    const { port1, port2 } = new MessageChannel();
    exposeEngine(port1);
    const engine = connectEngine(port2, async () => {
      throw new Error("offline");
    });
    await expect(engine.search("anything")).rejects.toThrow(/offline/);
    port1.close();
    port2.close();
  });
});
