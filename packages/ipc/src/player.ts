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
} from "./bindings.ts";
import { call, isTauri, rustTrackId, type Same } from "./tauri.ts";

export type { AudioDevice, AudioStats } from "./bindings.ts";

/** The queue is written against core's statuses, which mpv's must match. */
const statusesMatch: Same<PlaybackStatus, CorePlaybackStatus> = true;
void statusesMatch;

/** The outputs mpv can play through. Empty outside Tauri. */
export async function playerAudioDevices(): Promise<AudioDevice[]> {
  if (!isTauri) return [];
  return call("playerAudioDevices");
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

  async load(lease: StreamLease, paused = false): Promise<void> {
    await this.#ensureSubscribed();
    await call("playerLoad", { ...loadRequest(lease), startPaused: paused });
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

  async seek(positionMs: number): Promise<void> {
    await call("playerSeek", Math.max(0, Math.round(positionMs)));
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
      for (const listener of this.#listeners) listener(event);
    };
    await call("playerSubscribe", channel);
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
