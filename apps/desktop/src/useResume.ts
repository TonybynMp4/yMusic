import { useEffect, useRef } from "react";

import { engine } from "./engine.ts";
import type { usePlayer } from "./usePlayer.ts";

/**
 * YouTube Music's "Resume": once signed in, and with nothing queued here yet,
 * put the account's last queue, from whichever device played it, in the
 * player bar, paused on the song that was playing. As on YouTube Music, this
 * happens once, at launch or sign-in.
 */
export function useResume(player: ReturnType<typeof usePlayer>, account: string | null): void {
  const asked = useRef<string | null>(null);
  const { cue } = player;
  const empty = player.queue.cursor === null;
  /** Read when the answer arrives, since the user may have started something meanwhile. */
  const stillEmpty = useRef(empty);
  stillEmpty.current = empty;

  useEffect(() => {
    if (account === null || asked.current === account || !stillEmpty.current) return;
    asked.current = account;
    void engine
      .serverQueue()
      .then((queue) => {
        if (queue && stillEmpty.current) cue(queue.tracks, queue.index, queue.playlistId);
      })
      .catch((error: unknown) => console.error("could not load the queue to resume", error));
  }, [account, cue]);
}
