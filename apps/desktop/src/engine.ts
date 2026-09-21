import { appFetch, isTauri } from "@ymusic/ipc";
import { connectEngine } from "@ymusic/youtube/host";

import { botguard } from "./botguard.ts";

/**
 * The YouTube engine, running in a worker for the life of the app.
 *
 * youtubei.js (the InnerTube client, its parsers, and the player JavaScript it
 * downloads and interprets) lives entirely on the other side, so none of that
 * parsing competes with the UI thread. The worker has no Tauri IPC, so its
 * requests come back here to go out through `appFetch`, and it has no DOM, so
 * BotGuard, for the PO-token fallback, runs in a frame this side owns.
 */
export const engine = connectEngine(
  new Worker(new URL("./engine.worker.ts", import.meta.url), {
    type: "module",
    name: "youtube-engine",
  }),
  appFetch,
  // The frame is served by the app; a plain browser has nothing to load.
  isTauri ? botguard : undefined,
);
