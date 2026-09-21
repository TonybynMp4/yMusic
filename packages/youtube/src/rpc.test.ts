import { describe, expect, it } from "vitest";
import type { VideoId } from "@ytbm/core";

import { connectEngine } from "./host.ts";
import { exposeEngine } from "./worker.ts";

/**
 * The engine exactly as the app runs it — Comlink on one side, the fetch bridge
 * on the other — but over a `MessageChannel` in one process instead of a Worker.
 * Every request crosses the port twice, so a body that fails to transfer or a
 * header that gets dropped breaks this the same way it would break the app.
 *
 * Network-gated like `live.test.ts`; run with `YTBM_NETWORK_TESTS=1`.
 */
const live = process.env.YTBM_NETWORK_TESTS === "1" ? describe : describe.skip;

live("the engine across a message port", () => {
  it("searches and resolves a stream", { timeout: 60_000 }, async () => {
    const { port1, port2 } = new MessageChannel();
    exposeEngine(port1);
    let requests = 0;
    const engine = connectEngine(port2, (input, init) => {
      requests += 1;
      return globalThis.fetch(input, init);
    });

    const tracks = await engine.search("boards of canada roygbiv");
    expect(tracks.length).toBeGreaterThan(0);
    // The requests really went through the host, not around it.
    expect(requests).toBeGreaterThan(0);

    const first = tracks[0]!;
    const lease = await engine.resolve(first.id.slice("yt:".length) as VideoId);
    expect(lease.trackId).toBe(first.id);
    expect(lease.url).toMatch(/^https:\/\/.*googlevideo\.com\//);

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
