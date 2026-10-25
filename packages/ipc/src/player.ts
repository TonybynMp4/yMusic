import { Channel } from "@tauri-apps/api/core";
import type {
  PlaybackEngine,
  PlaybackEvent,
  PlaybackStatus as CorePlaybackStatus,
  StreamLease,
  TrackId,
} from "@ymusic/core";

import type {
  AudioDevice,
  AudioStats,
  LoadRequest,
  PlaybackEvent as RustPlaybackEvent,
  PlaybackStatus,
  Position,
  SavedVolume,
} from "./bindings.ts";
import { call, isTauri, rustTrackId, type Same } from "./tauri.ts";

export type { AudioDevice, AudioStats, Position, SavedVolume } from "./bindings.ts";

/** The queue is written against core's statuses, which mpv's must match. */
const statusesMatch: Same<PlaybackStatus, CorePlaybackStatus> = true;
void statusesMatch;

/** The outputs mpv can play through. Empty outside Tauri. */
export async function playerAudioDevices(): Promise<AudioDevice[]> {
  if (!isTauri) return [];
  return call("playerAudioDevices");
}

/**
 * The volume the last run left off at, and the last one above zero, for
 * Unmute. Both are slider positions in 0..1.
 */
export const fullVolume: SavedVolume = { volume: 1, unmuted: 1 };

/** Full volume outside Tauri, where nothing is saved. */
export async function playerSavedVolume(): Promise<SavedVolume> {
  if (!isTauri) return fullVolume;
  return call("playerSavedVolume");
}

/** Stats for nerds' readings for the song playing. Null outside Tauri. */
export async function playerStats(): Promise<AudioStats | null> {
  if (!isTauri) return null;
  return call("playerStats");
}

function loadRequest(lease: StreamLease): LoadRequest {
  return {
    trackId: lease.trackId,
    url: lease.url,
    headers: lease.headers,
    loudnessDb: lease.loudnessDb,
  };
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
    await call("playerLoad", {
      ...loadRequest(lease),
      startPaused: paused,
      startMs: startMs === undefined ? null : Math.max(0, Math.round(startMs)),
    });
  }

  async queueNext(after: TrackId, lease: StreamLease | null): Promise<void> {
    await call("playerQueueNext", after, lease && loadRequest(lease));
  }

  async play(): Promise<void> {
    await call("playerPlay");
  }

  async pause(): Promise<void> {
    await call("playerPause");
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
      await call("playerSeek", Math.max(0, Math.round(positionMs)));
    } catch (error) {
      this.#seeking = false;
      if (this.#playing) this.#pollIn(0);
      throw error;
    }
  }

  async setVolume(volume: number): Promise<void> {
    await call("playerSetVolume", volume);
  }

  async stop(): Promise<void> {
    await call("playerStop");
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
    const channel = new Channel<RustPlaybackEvent>();
    channel.onmessage = (message) => {
      const event = toCoreEvent(message);
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
    await call("playerSubscribe", channel);
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
    let position: Position | null = null;
    try {
      position = await call("playerPosition");
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

function toCoreEvent(event: RustPlaybackEvent): PlaybackEvent {
  switch (event.type) {
    case "status":
      return { type: "status", status: event.status };
    case "position":
      return { type: "position", positionMs: event.positionMs, durationMs: event.durationMs };
    case "ended":
      return { type: "ended", trackId: optionalTrackId(event.trackId) };
    case "advanced":
      return { type: "advanced", trackId: rustTrackId(event.trackId) };
    case "error":
      return { type: "error", trackId: optionalTrackId(event.trackId), message: event.message };
  }
}

function optionalTrackId(id: string | null): TrackId | null {
  return id === null ? null : rustTrackId(id);
}
