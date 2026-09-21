import type { ProxyMarked, Remote } from "comlink";

import type { YouTubeEngine } from "./engine.ts";
import type { BotGuardVm } from "./po-token.ts";
import type { SerializedRequest, SerializedResponse } from "./remote-fetch.ts";

/**
 * What the main thread offers the worker: the network. See `remote-fetch.ts`
 * for why the worker cannot reach YouTube itself.
 */
export interface EngineHost {
  fetch(request: SerializedRequest): Promise<SerializedResponse>;
  /**
   * BotGuard, when the host has one. It needs a DOM, which a worker lacks, so
   * the host runs it in an isolated frame and relays. See `po-token.ts`.
   */
  botguardLoad: BotGuardVm["load"];
  botguardCreateMinter: BotGuardVm["createMinter"];
  botguardMint: BotGuardVm["mint"];
}

/** What the worker offers the main thread. */
export interface EngineWorkerApi {
  /**
   * Must be the first call; every other one fetches through the host. Comlink
   * unwraps a `proxy()`-marked argument into this remote on arrival. Without
   * `hasBotGuard` the host's BotGuard methods reject and there is no fallback.
   */
  connect(host: Remote<EngineHost & ProxyMarked>, hasBotGuard: boolean): void;
  setCookie: YouTubeEngine["setCookie"];
  account: YouTubeEngine["account"];
  search: YouTubeEngine["search"];
  album: YouTubeEngine["album"];
  artist: YouTubeEngine["artist"];
  playlist: YouTubeEngine["playlist"];
  resolve: YouTubeEngine["resolve"];
}
