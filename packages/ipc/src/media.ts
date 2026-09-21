/**
 * The OS media session: media keys, MPRIS on Linux, SMTC on Windows.
 *
 * Rust reports play state and position to the OS on its own, straight from
 * mpv. What it cannot know is what is playing and how loud the slider is, so
 * those come from here, and the keys go the other way, because only the
 * frontend owns the queue that "next" moves through.
 */

import type { Track } from "@ytbm/core";
import { z } from "zod";

import { localPathFromArtUrl } from "./library.ts";
import { invokeVoid, isTauri } from "./tauri.ts";

/** Mirrors the Rust `MediaKeyEvent`. */
export const MediaKeyEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("play") }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("toggle") }),
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("previous") }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("seekBy"), offsetMs: z.number().int() }),
  z.object({ type: z.literal("setPosition"), positionMs: z.number().int().nonnegative() }),
  z.object({ type: z.literal("setVolume"), volume: z.number().min(0).max(1) }),
]);
export type MediaKeyEvent = z.infer<typeof MediaKeyEvent>;

/** The payload `media_set_track` takes. */
export interface MediaTrack {
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  coverPath: string | null;
  durationMs: number | null;
}

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
  await invokeVoid("media_set_track", { track });
}

/** A slider position in 0..1, as the player takes it. */
export async function mediaSetVolume(volume: number): Promise<void> {
  if (!isTauri) return;
  await invokeVoid("media_set_volume", { volume });
}

/**
 * Listens for media keys. Rust holds one channel, so a second subscription
 * replaces the first; the app subscribes once, at the top.
 */
export function subscribeMediaKeys(listener: (event: MediaKeyEvent) => void): () => void {
  let active = true;
  if (isTauri) {
    void (async () => {
      const { Channel } = await import("@tauri-apps/api/core");
      const channel = new Channel<unknown>();
      channel.onmessage = (message) => {
        if (!active) return;
        const parsed = MediaKeyEvent.safeParse(message);
        if (!parsed.success) {
          console.error("dropping malformed media key event", parsed.error, message);
          return;
        }
        listener(parsed.data);
      };
      await invokeVoid("media_subscribe", { channel });
    })().catch((error: unknown) => console.error("could not subscribe to media keys", error));
  }
  return () => {
    active = false;
  };
}
