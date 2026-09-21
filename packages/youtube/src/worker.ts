/**
 * The worker's half of the engine. A worker entry file only needs to import
 * this module and call `exposeEngine()`.
 */

import { expose, transfer, type Endpoint, type Remote } from "comlink";

import type { FetchLike } from "./client.ts";
import { YouTubeEngine } from "./engine.ts";
import type { BotGuardVm } from "./po-token.ts";
import { deserializeResponse, serializeRequest } from "./remote-fetch.ts";
import type { EngineHost, EngineWorkerApi } from "./rpc.ts";

/** `endpoint` defaults to the worker's own scope; tests pass a `MessagePort`. */
export function exposeEngine(endpoint: Endpoint = self as unknown as Endpoint): void {
  let host: Remote<EngineHost> | null = null;
  const connected = (): Remote<EngineHost> => {
    if (host === null) throw new Error("the engine worker was used before `connect`");
    return host;
  };

  const fetch: FetchLike = async (input, init) => {
    const request = await serializeRequest(input, init);
    const response = await connected().fetch(
      request.body ? transfer(request, [request.body]) : request,
    );
    return deserializeResponse(response);
  };
  const botguard: BotGuardVm = {
    load: (challenge) => connected().botguardLoad(challenge),
    createMinter: (integrityToken) => connected().botguardCreateMinter(integrityToken),
    mint: (binding) => connected().botguardMint(binding),
  };
  let engine = new YouTubeEngine(fetch);

  const api: EngineWorkerApi = {
    connect(remote, hasBotGuard) {
      host = remote;
      if (hasBotGuard) engine = new YouTubeEngine(fetch, botguard);
    },
    setCookie: (cookie) => engine.setCookie(cookie),
    account: () => engine.account(),
    search: (query) => engine.search(query),
    album: (id) => engine.album(id),
    artist: (id) => engine.artist(id),
    playlist: (id) => engine.playlist(id),
    libraryPlaylists: () => engine.libraryPlaylists(),
    resolve: (videoId, options) => engine.resolve(videoId, options),
  };
  expose(api, endpoint);
}
