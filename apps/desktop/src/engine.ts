import { appFetch } from "@ytbm/ipc";
import { connectEngine } from "@ytbm/youtube/host";

/**
 * The YouTube engine, running in a worker for the life of the app.
 *
 * youtubei.js — the InnerTube client, its parsers, and the player JavaScript it
 * downloads and interprets — lives entirely on the other side, so none of that
 * parsing competes with the UI thread. The worker has no Tauri IPC, so its
 * requests come back here to go out through `appFetch`.
 */
export const engine = connectEngine(
  new Worker(new URL("./engine.worker.ts", import.meta.url), {
    type: "module",
    name: "youtube-engine",
  }),
  appFetch,
);
