/**
 * The main thread's half of the engine.
 *
 * Kept free of youtubei.js on purpose — only type imports reach across — so
 * importing it does not pull the InnerTube client and its parsers into the
 * main bundle, which is the whole point of having a worker.
 */

import { proxy, transfer, wrap, type Endpoint, type Remote } from "comlink";

import type { FetchLike } from "./client.ts";
import type { BotGuardVm } from "./po-token.ts";
import { performRequest } from "./remote-fetch.ts";
import type { EngineHost, EngineWorkerApi } from "./rpc.ts";

export type { BotGuardVm, BotGuardChallenge } from "./po-token.ts";

export type EngineClient = Remote<Omit<EngineWorkerApi, "connect">>;

/**
 * Wraps a worker running `exposeEngine()`, serving its network through `fetch`
 * and, when given one, BotGuard through `botguard`. Comlink delivers messages
 * in order, so the `connect` sent here arrives before any call the caller
 * makes with the returned client.
 */
export function connectEngine(
  worker: Endpoint,
  fetch: FetchLike,
  botguard?: BotGuardVm,
): EngineClient {
  const remote = wrap<EngineWorkerApi>(worker);
  const host: EngineHost = {
    async fetch(request) {
      const response = await performRequest(fetch, request);
      return response.body ? transfer(response, [response.body]) : response;
    },
    botguardLoad: (challenge) => withBotGuard().load(challenge),
    botguardCreateMinter: (integrityToken) => withBotGuard().createMinter(integrityToken),
    botguardMint: (binding) => withBotGuard().mint(binding),
  };
  const withBotGuard = (): BotGuardVm => {
    if (!botguard) throw new Error("this engine host has no BotGuard");
    return botguard;
  };
  void remote.connect(proxy(host), botguard !== undefined);
  return remote;
}
