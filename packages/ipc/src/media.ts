/**
 * The OS media session: media keys, MPRIS on Linux, SMTC on Windows.
 *
 * Rust reports play state and position to the OS on its own, straight from
 * mpv. What it cannot know is what is playing and how loud the slider is, so
 * those come from here, and the keys go the other way, because only the
 * frontend owns the queue that "next" moves through.
 */

import { Channel } from "@tauri-apps/api/core";
import type { Track } from "@ymusic/core";

import type { MediaKeyEvent, MediaTrack } from "./bindings.ts";
import { localPathFromArtUrl } from "./library.ts";
import { call, isTauri } from "./tauri.ts";

export type { MediaKeyEvent, MediaTrack } from "./bindings.ts";

/**
 * Lifts a `Track` into what the OS shows. The largest thumbnail, because the
 * lock screen and SMTC flyout draw it far bigger than a list row does; and a
 * local cover goes as a path, since the OS cannot read the webview's asset URLs.
 */
export function toMediaTrack(track: Track, durationMs: number | null): MediaTrack {
  const cover = track.thumbnails.reduce<Track["thumbnails"][number] | null>(
    (best, candidate) => (best === null || candidate.width > best.width ? candidate : best),
    null,
  );
  const coverPath = cover ? localPathFromArtUrl(cover.url) : null;
  return {
    title: track.title,
    artist: track.artists.map((artist) => artist.name).join(", "),
    album: track.album,
    coverUrl: coverPath === null ? (cover?.url ?? null) : null,
    coverPath,
    durationMs: durationMs ?? track.durationMs,
  };
}

export async function mediaSetTrack(track: MediaTrack | null): Promise<void> {
  if (!isTauri) return;
  await call("mediaSetTrack", track);
}

/** A slider position in 0..1, as the player takes it. */
export async function mediaSetVolume(volume: number): Promise<void> {
  if (!isTauri) return;
  await call("mediaSetVolume", volume);
}

/**
 * Listens for media keys. Rust holds one channel, so a second subscription
 * replaces the first; the app subscribes once, at the top.
 */
export function subscribeMediaKeys(listener: (event: MediaKeyEvent) => void): () => void {
  let active = true;
  if (isTauri) {
    const channel = new Channel<MediaKeyEvent>();
    channel.onmessage = (event) => {
      if (active) listener(event);
    };
    call("mediaSubscribe", channel).catch((error: unknown) =>
      console.error("could not subscribe to media keys", error),
    );
  }
  return () => {
    active = false;
  };
}
