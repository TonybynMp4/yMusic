import { appFetch, isTauri } from "@ymusic/ipc";
import { connectEngine, extractInWorker } from "@ymusic/youtube/host";

import { botguard } from "./botguard.ts";

const expiredListeners = new Set<() => void>();

/** Hears when YouTube stops accepting the saved session. Returns the unsubscribe. */
export function onSessionExpired(listener: () => void): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

/**
 * The YouTube engine, running in a worker for the life of the app.
 *
 * youtubei.js (the InnerTube client, its parsers, and the player JavaScript it
 * downloads and interprets) lives entirely on the other side, so none of that
 * parsing competes with the UI thread. The worker has no Tauri IPC, so its
 * requests come back here to go out through `appFetch`, and it has no DOM, so
 * BotGuard, for the PO-token fallback, runs in a frame this side owns.
 *
 * The player script is the exception: analysing it leaves about 200 MB
 * resident in whichever worker does it, so it runs in one started for the job
 * and ended after, and the result is kept for the next launch.
 */
export const engine = connectEngine(
  new Worker(new URL("./engine.worker.ts", import.meta.url), {
    type: "module",
    name: "youtube-engine",
  }),
  appFetch,
  {
    // The frame is served by the app; a plain browser has nothing to load.
    botguard: isTauri ? botguard : undefined,
    onSessionExpired: () => {
      for (const listener of expiredListeners) listener();
    },
    playerScript: extractInWorker(
      appFetch,
      () =>
        new Worker(new URL("./player-script.worker.ts", import.meta.url), {
          type: "module",
          name: "player-script",
        }),
      localStorage,
    ),
  },
);
