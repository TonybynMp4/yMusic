import { useEffect, useRef } from "react";
import { mediaSetTrack, mediaSetVolume, subscribeMediaKeys, toMediaTrack } from "@ytbm/ipc";

import type { usePlayer } from "./usePlayer.ts";

type Player = ReturnType<typeof usePlayer>;

function logMediaFailure(error: unknown): void {
  console.error("media session update failed", error);
}

/**
 * Connects the player to the OS media session: media keys and headset buttons
 * in, track details and volume out. Play state and position are not sent from
 * here — Rust reports those straight from mpv, which sees every seek.
 */
export function useMediaSession(player: Player) {
  // The subscription is made once, so it reads the player through a ref: the
  // callbacks close over playback state and are rebuilt every render.
  const latest = useRef(player);
  latest.current = player;

  useEffect(
    () =>
      subscribeMediaKeys((event) => {
        const current = latest.current;
        switch (event.type) {
          case "play":
            return current.play();
          case "pause":
          // MPRIS "stop" usually comes from a widget with no pause button;
          // throwing the queue away in response would be a surprise.
          case "stop":
            return current.pause();
          case "toggle":
            return current.toggle();
          case "next":
            return current.next();
          case "previous":
            return current.previous();
          case "seekBy": {
            const target = current.playback.positionMs + event.offsetMs;
            const duration = current.playback.durationMs;
            return current.seek(Math.max(0, duration === null ? target : Math.min(target, duration)));
          }
          case "setPosition":
            return current.seek(event.positionMs);
          case "setVolume":
            return current.setVolume(event.volume);
        }
      }),
    [],
  );

  const { track } = player;
  const durationMs = player.playback.durationMs;
  useEffect(() => {
    void mediaSetTrack(track ? toMediaTrack(track, durationMs) : null).catch(logMediaFailure);
  }, [track, durationMs]);

  useEffect(() => {
    void mediaSetVolume(player.volume).catch(logMediaFailure);
  }, [player.volume]);
}
