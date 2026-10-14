import { useEffect, useRef, useState } from "react";
import { queueLoad } from "@ymusic/ipc";
import { isSharedQueue, type ServerQueue } from "@ymusic/youtube/host";

import { engine } from "./engine.ts";
import type { usePlayer } from "./usePlayer.ts";

/**
 * Brings a queue back at launch, paused on its song. Two places can have
 * one: the queue this device saved, and the account's server queue, which
 * is YouTube Music's "Resume" and may come from any device.
 *
 * The saved queue comes back, position included, when the server queue is
 * still what this device last wrote to it, so nothing has played elsewhere
 * since. When the server queue differs, another device has moved on, and it
 * wins. Signed out, offline, or with an empty server queue (a free account
 * may get nothing), the saved queue comes back unchecked.
 *
 * Signing in later, with nothing queued, puts the server queue in the player
 * bar, once per account, as YouTube Music does.
 *
 * `accountReady` is false until the saved session has been tried. Returns
 * whether the launch decision is made: until then, saving the queue would
 * write over the saved one with an empty queue.
 */
export function useResume(
  player: ReturnType<typeof usePlayer>,
  account: string | null,
  accountReady: boolean,
): boolean {
  const [settled, setSettled] = useState(false);
  const launched = useRef(false);
  const asked = useRef<string | null>(null);
  const { cue, restore } = player;
  const empty = player.queue.cursor === null;
  /** Read when the answer arrives, since the user may have started something meanwhile. */
  const stillEmpty = useRef(empty);
  stillEmpty.current = empty;

  useEffect(() => {
    if (!accountReady || launched.current) return;
    launched.current = true;
    asked.current = account;
    void (async () => {
      const saved = await queueLoad().catch((error: unknown) => {
        console.error("could not read the saved queue", error);
        return { queue: null, position: null };
      });
      let server: ServerQueue | null = null;
      if (account !== null) {
        server = await engine.serverQueue().catch((error: unknown) => {
          console.error("could not load the queue to resume", error);
          return null;
        });
      }
      if (!stillEmpty.current) return;
      const local = saved.queue;
      const ours =
        local?.shared != null &&
        server !== null &&
        local.shared.account === account &&
        isSharedQueue(server, local.shared);
      if (local && (server === null || ours) && restore(local, saved.position)) return;
      if (server) cue(server.tracks, server.index, server.playlistId);
    })().finally(() => setSettled(true));
  }, [accountReady, account, cue, restore]);

  useEffect(() => {
    if (!launched.current || account === null || asked.current === account) return;
    if (!stillEmpty.current) return;
    asked.current = account;
    void engine
      .serverQueue()
      .then((queue) => {
        if (queue && stillEmpty.current) cue(queue.tracks, queue.index, queue.playlistId);
      })
      .catch((error: unknown) => console.error("could not load the queue to resume", error));
  }, [account, cue]);

  return settled;
}
