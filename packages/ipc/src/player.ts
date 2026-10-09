import { z } from "zod";
import { TrackId } from "@ymusic/core";
import type { PlaybackEngine, PlaybackEvent, StreamLease } from "@ymusic/core";
import { invokeParsed, invokeVoid, isTauri } from "./tauri.ts";

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
  z.object({ type: z.literal("advanced"), trackId: z.string() }),
  z.object({
    type: z.literal("error"),
    trackId: z.string().nullable(),
    message: z.string(),
  }),
]);
export type RustPlaybackEvent = z.infer<typeof RustPlaybackEvent>;

const PlayerPosition = z
  .object({
    positionMs: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .nullable();

export const AudioDevice = z.object({ name: z.string(), description: z.string() });
export type AudioDevice = z.infer<typeof AudioDevice>;

/** The outputs mpv can play through. Empty outside Tauri. */
export async function playerAudioDevices(): Promise<AudioDevice[]> {
  if (!isTauri) return [];
  return invokeParsed("player_audio_devices", z.array(AudioDevice));
}

/**
 * Mirrors `volume::SavedVolume`: the volume the last run left off at, and the
 * last one above zero, for Unmute. Both are slider positions in 0..1.
 */
export const SavedVolume = z.object({
  volume: z.number().min(0).max(1),
  unmuted: z.number().min(0).max(1),
});
export type SavedVolume = z.infer<typeof SavedVolume>;

export const fullVolume: SavedVolume = { volume: 1, unmuted: 1 };

/** Full volume outside Tauri, where nothing is saved. */
export async function playerSavedVolume(): Promise<SavedVolume> {
  if (!isTauri) return fullVolume;
  return invokeParsed("player_saved_volume", SavedVolume);
}

/** Mirrors `playback::AudioStats`: what stats for nerds shows. */
export const AudioStats = z.object({
  codec: z.string().nullable(),
  sampleRate: z.number().nullable(),
  channels: z.string().nullable(),
  bitrate: z.number().nullable(),
  youtubeLoudnessDb: z.number().nullable(),
  gainDb: z.number().nullable(),
  replaygainDb: z.number().nullable(),
  integratedLufs: z.number().nullable(),
  momentaryLufs: z.number().nullable(),
  peakDb: z.number().nullable(),
  outputPeakDb: z.number().nullable(),
  limiterDb: z.number().nullable(),
});
export type AudioStats = z.infer<typeof AudioStats>;

/** Readings for the song playing. Null outside Tauri. */
export async function playerStats(): Promise<AudioStats | null> {
  if (!isTauri) return null;
  return invokeParsed("player_stats", AudioStats);
}

/**
 * `PlaybackEngine` backed by libmpv in the Rust core.
 *
 * `load` replays the lease's headers, because googlevideo binds a stream URL to
 * the session that resolved it. mpv making the request with anything else gets
 * a 403 that looks like an unrelated bug.
 */
export class MpvPlaybackEngine implements PlaybackEngine {
  #listeners = new Set<(event: PlaybackEvent) => void>();
  #subscribed = false;
  #playing = false;
  #seeking = false;
  // Bumped whenever a reply in flight would be stale, so it gets dropped.
  #asked = 0;
  #poll: ReturnType<typeof setTimeout> | null = null;

  async load(lease: StreamLease, paused = false, startMs?: number): Promise<void> {
    await this.#ensureSubscribed();
    await invokeVoid("player_load", {
      request: {
        trackId: lease.trackId,
        url: lease.url,
        headers: lease.headers,
        loudnessDb: lease.loudnessDb,
        startPaused: paused,
        startMs: startMs === undefined ? null : Math.max(0, Math.round(startMs)),
      },
    });
  }

  queueNext(after: TrackId, lease: StreamLease | null): Promise<void> {
    return invokeVoid("player_queue_next", {
      after,
      request: lease && {
        trackId: lease.trackId,
        url: lease.url,
        headers: lease.headers,
        loudnessDb: lease.loudnessDb,
      },
    });
  }

  play(): Promise<void> {
    return invokeVoid("player_play");
  }

  pause(): Promise<void> {
    return invokeVoid("player_pause");
  }

  /**
   * mpv only moves `time-pos` once the seek lands, so a reply asked for before
   * then still holds the old position and would pull the bar back for a
   * second. Polling waits for the status the core sends when playback
   * restarts, which comes with the new position.
   */
  async seek(positionMs: number): Promise<void> {
    this.#seeking = true;
    this.#stopPolling();
    try {
      await invokeVoid("player_seek", { positionMs: Math.max(0, Math.round(positionMs)) });
    } catch (error) {
      this.#seeking = false;
      if (this.#playing) this.#pollIn(0);
      throw error;
    }
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
      // A failed stream gets an error and no status after it, so the error
      // has to stop the polling too.
      if (event.type === "status" || event.type === "error") {
        this.#seeking = false;
        this.#playing = event.type === "status" && event.status === "playing";
        if (this.#playing) this.#pollIn(0);
        else this.#stopPolling();
      }
      this.#deliver(event);
    };
    await invokeVoid("player_subscribe", { channel });
  }

  #deliver(event: PlaybackEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  /**
   * The core only pushes the position when a song starts or after a seek.
   * Every message it pushes reaches the page as a script WebKit compiles and
   * keeps, while a command's reply leaves nothing behind, so while a song
   * plays the page asks for the position instead.
   */
  #pollIn(delayMs: number): void {
    this.#stopPolling();
    this.#poll = setTimeout(() => void this.#askPosition(), delayMs);
  }

  #stopPolling(): void {
    if (this.#poll !== null) clearTimeout(this.#poll);
    this.#poll = null;
    this.#asked++;
  }

  async #askPosition(): Promise<void> {
    this.#poll = null;
    const asked = this.#asked;
    let position: z.infer<typeof PlayerPosition> = null;
    try {
      position = await invokeParsed("player_position", PlayerPosition);
    } catch (error) {
      console.error("could not read the playback position", error);
    }
    // Nothing loaded: the next "playing" status starts the polling again.
    if (!this.#playing || this.#seeking || asked !== this.#asked || !position) return;
    this.#deliver({ type: "position", ...position });
    // Just after the next whole second, so the time label ticks on time.
    this.#pollIn(1000 - (position.positionMs % 1000) + 20);
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
    case "advanced":
      return { type: "advanced", trackId: toTrackId(event.trackId)! };
    case "error":
      return { type: "error", trackId: toTrackId(event.trackId), message: event.message };
  }
}
