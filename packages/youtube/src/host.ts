/**
 * The main thread's half of the engine.
 *
 * Kept free of youtubei.js on purpose (only type imports reach across), so
 * importing it does not pull the InnerTube client and its parsers into the
 * main bundle, which is the whole point of having a worker.
 */

import { proxy, transfer, wrap, type Endpoint, type Remote } from "comlink";

import type { FetchLike } from "./client.ts";
import type { ExtractorApi } from "./extractor.ts";
import { playerScriptUrl, type PlayerScript, type PlayerScriptSource } from "./player-script.ts";
import type { BotGuardVm } from "./po-token.ts";
import { performRequest } from "./remote-fetch.ts";
import type { EngineHost, EngineWorkerApi } from "./rpc.ts";

export type { BotGuardVm, BotGuardChallenge } from "./po-token.ts";
export type { PlayerScript, PlayerScriptSource } from "./player-script.ts";
export type { NewPlaylist, PlaylistTarget } from "./browse.ts";
export type { PlaylistDetails, PlaylistItem } from "./edit.ts";
export type { WatchReport } from "./history.ts";
export type { Rating } from "./rating.ts";
export type { ServerQueue } from "./resume.ts";
export { isSharedQueue, type SharedQueue } from "./shared-queue.ts";
export type { SearchHistoryEntry } from "./search-history.ts";

export type EngineClient = Remote<Omit<EngineWorkerApi, "connect">>;

export interface EngineHostOptions {
  /** BotGuard, for the PO-token fallback. */
  botguard?: BotGuardVm | undefined;
  /**
   * Hears when YouTube stops accepting the saved session, which the engine
   * has already dropped by then.
   */
  onSessionExpired?: () => void;
  /** Analyses the player script outside the engine worker. */
  playerScript?: PlayerScriptSource | undefined;
}

/**
 * Wraps a worker running `exposeEngine()`, serving its network through
 * `fetch` and the rest through `options`. Comlink delivers messages in order,
 * so the `connect` sent here arrives before any call the caller makes with
 * the returned client.
 */
export function connectEngine(
  worker: Endpoint,
  fetch: FetchLike,
  options: EngineHostOptions = {},
): EngineClient {
  const { botguard, onSessionExpired = () => {}, playerScript } = options;
  const remote = wrap<EngineWorkerApi>(worker);
  const host: EngineHost = {
    async fetch(request) {
      const response = await performRequest(fetch, request);
      return response.body ? transfer(response, [response.body]) : response;
    },
    botguardLoad: (challenge) => withBotGuard().load(challenge),
    botguardCreateMinter: (integrityToken) => withBotGuard().createMinter(integrityToken),
    botguardMint: (binding) => withBotGuard().mint(binding),
    sessionExpired: () => onSessionExpired(),
    playerScript: (playerId, libraryVersion) => {
      if (!playerScript) throw new Error("this engine host does not analyse player scripts");
      return playerScript(playerId, libraryVersion);
    },
  };
  const withBotGuard = (): BotGuardVm => {
    if (!botguard) throw new Error("this engine host has no BotGuard");
    return botguard;
  };
  void remote.connect(proxy(host), {
    botguard: botguard !== undefined,
    playerScript: playerScript !== undefined,
  });
  return remote;
}

/** A worker running `exposeExtractor()`, which can be ended. */
export type ExtractorWorker = Endpoint & { terminate(): void };

/** Where the last analysed player script is kept, as JSON. */
const PLAYER_SCRIPT_KEY = "ymusic.player-script";

/**
 * Analyses player scripts in a worker started for the job and ended after it,
 * so the memory the parse leaves resident goes with it. The result is kept in
 * `storage`, so a launch on the same player script (YouTube moves to a new
 * one every week or so) skips both the download and the parse.
 */
export function extractInWorker(
  fetch: FetchLike,
  startWorker: () => ExtractorWorker,
  storage?: Storage,
): PlayerScriptSource {
  return async (playerId, libraryVersion) => {
    const kept = keptPlayerScript(storage, playerId, libraryVersion);
    if (kept) return kept;
    const response = await fetch(playerScriptUrl(playerId));
    if (!response.ok) throw new Error(`the player script answered ${response.status}`);
    const source = await response.text();
    const worker = startWorker();
    const failure = new AbortController();
    try {
      const script = await Promise.race([
        wrap<ExtractorApi>(worker).extract(playerId, source),
        workerFailure(worker, failure.signal),
      ]);
      try {
        storage?.setItem(PLAYER_SCRIPT_KEY, JSON.stringify({ libraryVersion, script }));
      } catch {
        // Full storage only means the next launch analyses it again.
      }
      return script;
    } finally {
      failure.abort();
      worker.terminate();
    }
  };
}

/** Longer than any parse takes, even on a slow machine under load. */
const EXTRACT_TIMEOUT_MS = 60_000;

/**
 * Rejects when the worker fails to load, dies, or never answers. A comlink
 * call to a dead worker never settles, and the resolve waiting on it would
 * hang instead of moving on to the next player client. `done` stops the clock.
 */
function workerFailure(worker: ExtractorWorker, done: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = (event: Event) =>
      reject(
        new Error(`the extractor worker failed: ${(event as ErrorEvent).message ?? event.type}`),
      );
    worker.addEventListener("error", fail);
    worker.addEventListener("messageerror", fail);
    const timer = setTimeout(
      () => reject(new Error("the extractor worker did not answer in time")),
      EXTRACT_TIMEOUT_MS,
    );
    done.addEventListener("abort", () => clearTimeout(timer));
  });
}

function keptPlayerScript(
  storage: Storage | undefined,
  playerId: string,
  libraryVersion: string,
): PlayerScript | null {
  try {
    const kept = JSON.parse(storage?.getItem(PLAYER_SCRIPT_KEY) ?? "null") as {
      libraryVersion: string;
      script: PlayerScript;
    } | null;
    if (kept?.libraryVersion !== libraryVersion || kept.script.playerId !== playerId) return null;
    return kept.script;
  } catch {
    return null;
  }
}
