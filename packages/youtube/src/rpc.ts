import type { ProxyMarked, Remote } from "comlink";

import type { YouTubeEngine } from "./engine.ts";
import type { SerializedRequest, SerializedResponse } from "./remote-fetch.ts";

/**
 * What the main thread offers the worker: the network. See `remote-fetch.ts`
 * for why the worker cannot reach YouTube itself.
 */
export interface EngineHost {
  fetch(request: SerializedRequest): Promise<SerializedResponse>;
}

/** What the worker offers the main thread. */
export interface EngineWorkerApi {
  /** Must be the first call; every other one fetches through the host. */
  /** Comlink unwraps a `proxy()`-marked argument into this remote on arrival. */
  connect(host: Remote<EngineHost & ProxyMarked>): void;
  search: YouTubeEngine["search"];
  resolve: YouTubeEngine["resolve"];
}
