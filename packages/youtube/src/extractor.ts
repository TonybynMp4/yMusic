/**
 * A worker that analyses one player script and is then thrown away, taking
 * the memory the parse leaves resident with it. See `player-script.ts`. A
 * worker entry file only needs to import this module and call
 * `exposeExtractor()`.
 */

import { expose, type Endpoint } from "comlink";

import { extractPlayerScript } from "./player-extract.ts";

export interface ExtractorApi {
  extract: typeof extractPlayerScript;
}

/** `endpoint` defaults to the worker's own scope; tests pass a `MessagePort`. */
export function exposeExtractor(endpoint: Endpoint = self as unknown as Endpoint): void {
  const api: ExtractorApi = { extract: extractPlayerScript };
  expose(api, endpoint);
}
