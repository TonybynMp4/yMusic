import { Listened, type PlaybackStatus, type TrackId, videoIdFromTrackId } from "@ymusic/core";
import type { WatchReport } from "@ymusic/youtube/host";
import { useCallback, useEffect, useRef } from "react";

import { engine as youtube } from "./engine.ts";
import type { PositionStore } from "./usePlayback.ts";

/**
 * When the web player reports watch time, measured from the start of a play:
 * every ten seconds at first, then every forty.
 */
function reportDelay(reports: number): number {
  return reports < 3 ? 10_000 : 40_000;
}

/** One play of one YouTube song, from its first moment playing to its final report. */
interface Play {
  trackId: TrackId;
  /** Null until it first plays, and when YouTube gave nothing to report to. */
  handle: Promise<string | null> | null;
  listened: Listened;
  reports: number;
  nextReportAt: number;
}

function logFailure(error: unknown): void {
  console.error("could not report playback to YouTube", error);
}

/**
 * Reports YouTube songs to the signed-in account as they play, as YouTube
 * Music's own player does: the song goes into the history when it starts, and
 * the stretches listened to follow as watch time. Signed out, the engine
 * declines and nothing is sent. Local files are never reported, and while
 * `paused` no new play starts, so nothing new reaches the history.
 */
export function useWatchHistory(
  trackId: TrackId | null,
  status: PlaybackStatus,
  position: PositionStore,
  paused: boolean,
): void {
  const play = useRef<Play | null>(null);
  const playing = useRef(false);

  const report = useCallback(
    (current: Play, final: boolean) => {
      const handle = current.handle;
      if (handle === null) return;
      const segments = current.listened.take();
      current.reports += 1;
      current.nextReportAt = Date.now() + reportDelay(current.reports);
      const watch: WatchReport = {
        segments,
        positionMs: position.get(),
        playing: playing.current,
        final,
      };
      void handle
        .then((id) => (id === null ? undefined : youtube.watched(id, watch)))
        .catch(logFailure);
    },
    [position],
  );

  /** Sends the final report, after which the next moment playing is a new play. */
  const finish = useCallback(() => {
    const current = play.current;
    if (current === null) return;
    current.listened.pause();
    report(current, true);
    play.current = null;
  }, [report]);

  // A different track ends the old play. The next one starts once it plays,
  // not when it is queued up or still loading.
  useEffect(() => {
    if (play.current && play.current.trackId !== trackId) finish();
    playing.current = status === "playing";
    if (status === "ended") {
      finish();
      return;
    }
    const videoId = trackId === null ? null : videoIdFromTrackId(trackId);
    if (trackId === null || videoId === null) return;
    if (status === "playing" && play.current === null && !paused) {
      play.current = {
        trackId,
        handle: youtube.played(videoId).catch((error: unknown) => {
          logFailure(error);
          return null;
        }),
        listened: new Listened(),
        reports: 0,
        nextReportAt: Date.now() + reportDelay(0),
      };
      return;
    }
    // A pause is reported straight away, with the stretch it closed.
    const current = play.current;
    if (current && status === "paused") {
      current.listened.pause();
      report(current, false);
    }
  }, [trackId, status, paused, report, finish]);

  useEffect(
    () =>
      position.subscribe(() => {
        const current = play.current;
        if (current === null || !playing.current) return;
        current.listened.observe(position.get());
        if (Date.now() >= current.nextReportAt) report(current, false);
      }),
    [position, report],
  );

  // Closing the app ends whatever is playing. The report may not make it out
  // before the window goes, which costs a few seconds of watch time.
  useEffect(() => {
    const onUnload = () => finish();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      finish();
    };
  }, [finish]);
}
