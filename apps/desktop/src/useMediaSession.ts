import { useEffect, useEffectEvent } from "react";
import { mediaSetTrack, mediaSetVolume, subscribeMediaKeys, toMediaTrack } from "@ymusic/ipc";
import type { MediaKeyEvent } from "@ymusic/ipc";

import type { usePlayer } from "./usePlayer.ts";

type Player = ReturnType<typeof usePlayer>;

function logMediaFailure(error: unknown): void {
  console.error("media session update failed", error);
}

/**
 * Connects the player to the OS media session: media keys and headset buttons
 * in, track details and volume out. Play state and position are not sent from
 * here: Rust reports those straight from mpv, which sees every seek.
 */
export function useMediaSession(player: Player) {
  // The subscription is made once, so it reads the player through an effect
  // event: the callbacks close over playback state and change every render.
  const onMediaKey = useEffectEvent((event: MediaKeyEvent) => {
    switch (event.type) {
      case "play":
        return player.play();
      case "pause":
      // MPRIS "stop" usually comes from a widget with no pause button;
      // throwing the queue away in response would be a surprise.
      case "stop":
        return player.pause();
      case "toggle":
        return player.toggle();
      case "next":
        return player.next();
      case "previous":
        return player.previous();
      case "seekBy": {
        const target = player.position.get() + event.offsetMs;
        const duration = player.playback.durationMs;
        return player.seek(Math.max(0, duration === null ? target : Math.min(target, duration)));
      }
      case "setPosition":
        return player.seek(event.positionMs);
      case "setVolume":
        return player.setVolume(event.volume);
    }
  });
  useEffect(() => subscribeMediaKeys((event) => onMediaKey(event)), []);

  const { track } = player;
  const durationMs = player.playback.durationMs;
  useEffect(() => {
    void mediaSetTrack(track ? toMediaTrack(track, durationMs) : null).catch(logMediaFailure);
  }, [track, durationMs]);

  useEffect(() => {
    void mediaSetVolume(player.volume).catch(logMediaFailure);
  }, [player.volume]);
}
