import type { FetchLike } from "../src/client.ts";

/**
 * YouTube's player script for the `player-script` phase and the engine, analysed
 * where `--player-script` says. Choosing needs the engine to take its script
 * from outside youtubei.js (`src/player-extract.ts`, from Premium playback).
 * Without it the phase is skipped, and the engine parses the script itself
 * when it falls back.
 */
export interface PlayerScripts {
  /** For the engine's constructor; `undefined` leaves the engine its default. */
  source: unknown;
  /** Analyses the script once, or says the phase is skipped with `null`. */
  analyse: () => Promise<{ playerId: string; data: { output: string } } | null>;
}

type Source = (playerId: string, libraryVersion: string) => Promise<{
  playerId: string;
  data: { output: string };
}>;

export async function playerScripts(fetch: FetchLike, where: string): Promise<PlayerScripts> {
  const extract = await import("../src/player-extract.ts").catch(() => null);
  if (extract === null) return { source: undefined, analyse: async () => null };
  const { currentPlayerId } = await import("../src/player-script.ts");
  const { extractInWorker } = await import("../src/host.ts");
  // In a worker ended once it has the result, as in the app. Bun's workers are
  // threads in this process, as WebKit's are in the web process, so their
  // memory counts here.
  const base: Source =
    where === "in-process"
      ? extract.inProcessPlayerScript(fetch)
      : extractInWorker(
          fetch,
          () =>
            new Worker(new URL("./player-script.worker.ts", import.meta.url), {
              type: "module",
            }) as never,
        );
  // One analysis serves the phase and the engine both, as the engine keeps
  // its script for its life.
  let analysed: ReturnType<Source> | null = null;
  const source: Source = (playerId, libraryVersion) => (analysed ??= base(playerId, libraryVersion));
  return {
    source,
    // `none` skips the phase, as signed-in playback did before `WEB_REMIX`.
    analyse: async () =>
      where === "none" ? null : source(await currentPlayerId(fetch), extract.LIBRARY_VERSION),
  };
}
