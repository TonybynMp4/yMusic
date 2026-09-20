import { z } from "zod";
import { TrackId } from "@ytbm/core";
import type { PlaybackEngine, PlaybackEvent, StreamLease } from "@ytbm/core";
import { invokeVoid, isTauri } from "./tauri.ts";

/**
 * Mirrors the Rust `PlaybackEvent`. Parsed rather than cast: these arrive over
 * a channel from a thread we do not control, and a silent shape drift here
 * would show up as a stuck progress bar.
 */
export const RustPlaybackEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    status: z.enum(["idle", "loading", "playing", "paused", "ended"]),
  }),
  z.object({
    type: z.literal("position"),
    positionMs: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().nullable(),
  }),
  z.object({ type: z.literal("ended"), trackId: z.string().nullable() }),
  z.object({
    type: z.literal("error"),
    trackId: z.string().nullable(),
    message: z.string(),
  }),
]);
export type RustPlaybackEvent = z.infer<typeof RustPlaybackEvent>;

/**
 * `PlaybackEngine` backed by libmpv in the Rust core.
 *
 * `load` replays the lease's headers, because googlevideo binds a stream URL to
 * the session that resolved it — mpv making the request with anything else gets
 * a 403 that looks like an unrelated bug.
 */
export class MpvPlaybackEngine implements PlaybackEngine {
  #listeners = new Set<(event: PlaybackEvent) => void>();
  #subscribed = false;

  async load(lease: StreamLease): Promise<void> {
    await this.#ensureSubscribed();
    await invokeVoid("player_load", {
      request: {
        trackId: lease.trackId,
        url: lease.url,
        headers: lease.headers,
        startPaused: false,
      },
    });
  }

  play(): Promise<void> {
    return invokeVoid("player_play");
  }

  pause(): Promise<void> {
    return invokeVoid("player_pause");
  }

  seek(positionMs: number): Promise<void> {
    return invokeVoid("player_seek", { positionMs: Math.max(0, Math.round(positionMs)) });
  }

  setVolume(volume: number): Promise<void> {
    return invokeVoid("player_set_volume", { volume });
  }

  stop(): Promise<void> {
    return invokeVoid("player_stop");
  }

  subscribe(listener: (event: PlaybackEvent) => void): () => void {
    this.#listeners.add(listener);
    void this.#ensureSubscribed();
    return () => this.#listeners.delete(listener);
  }

  /**
   * One channel for the whole app, opened lazily. Rust keeps a single sink, so
   * subscribing twice would silently drop the first listener's events.
   */
  async #ensureSubscribed(): Promise<void> {
    if (this.#subscribed || !isTauri) return;
    this.#subscribed = true;
    const { Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<unknown>();
    channel.onmessage = (message) => {
      const parsed = RustPlaybackEvent.safeParse(message);
      if (!parsed.success) {
        console.error("dropping malformed playback event", parsed.error, message);
        return;
      }
      const event = toCoreEvent(parsed.data);
      for (const listener of this.#listeners) listener(event);
    };
    await invokeVoid("player_subscribe", { channel });
  }
}

/** Rust echoes the track id back as a plain string; re-brand it on the way in. */
function toTrackId(value: string | null): TrackId | null {
  if (value === null) return null;
  const parsed = TrackId.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toCoreEvent(event: RustPlaybackEvent): PlaybackEvent {
  switch (event.type) {
    case "status":
      return { type: "status", status: event.status };
    case "position":
      return { type: "position", positionMs: event.positionMs, durationMs: event.durationMs };
    case "ended":
      return { type: "ended", trackId: toTrackId(event.trackId)! };
    case "error":
      return { type: "error", trackId: toTrackId(event.trackId), message: event.message };
  }
}
