/**
 * The worker's half of the engine. A worker entry file only needs to import
 * this module and call `exposeEngine()`.
 */

import { expose, transfer, type Endpoint, type Remote } from "comlink";

import { YouTubeEngine } from "./engine.ts";
import { deserializeResponse, serializeRequest } from "./remote-fetch.ts";
import type { EngineHost, EngineWorkerApi } from "./rpc.ts";

/** `endpoint` defaults to the worker's own scope; tests pass a `MessagePort`. */
export function exposeEngine(endpoint: Endpoint = self as unknown as Endpoint): void {
  let host: Remote<EngineHost> | null = null;

  const engine = new YouTubeEngine(async (input, init) => {
    if (host === null) throw new Error("the engine worker was used before `connect`");
    const request = await serializeRequest(input, init);
    const response = await host.fetch(
      request.body ? transfer(request, [request.body]) : request,
    );
    return deserializeResponse(response);
  });

  const api: EngineWorkerApi = {
    connect(remote) {
      host = remote;
    },
    search: (query) => engine.search(query),
    resolve: (videoId) => engine.resolve(videoId),
  };
  expose(api, endpoint);
}
