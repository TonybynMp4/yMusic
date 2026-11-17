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
import { windowHidden, type WindowHiddenStore } from "./window.ts";

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

/**
 * How often the position is asked for while the window is hidden in the tray.
 * Nothing shows it then. What still reads it is the saved queue position,
 * every ten seconds, and the watch time reported to YouTube, which
 * `useWatchHistory` bridges across a gap this long.
 */
export const HIDDEN_POLL_MS = 10_000;

/** How often `syncPosition` asks again when a status drops its reply. */
const SYNC_TRIES = 3;

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
  // Playing or paused: a song mpv has, so its position is worth asking for.
  #loaded = false;
  #seeking = false;
  #hidden = false;
  #window: WindowHiddenStore;
  // Bumped whenever a reply in flight would be stale, so it gets dropped.
  #asked = 0;
  /** The `syncPosition` in flight, shared by every caller until it settles. */
  #syncing: Promise<void> | null = null;
  #poll: ReturnType<typeof setTimeout> | null = null;

  constructor(window: WindowHiddenStore = windowHidden) {
    this.#window = window;
  }

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
    this.#hidden = this.#window.get();
    this.#window.subscribe(() => this.#onHidden(this.#window.get()));
    const channel = new Channel<RustPlaybackEvent>();
    channel.onmessage = (message) => {
      const event = toCoreEvent(message);
      // A failed stream gets an error and no status after it, so the error
      // has to stop the polling too.
      if (event.type === "status" || event.type === "error") {
        this.#seeking = false;
        this.#playing = event.type === "status" && event.status === "playing";
        this.#loaded = this.#playing || (event.type === "status" && event.status === "paused");
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
   * Asks for the position now, outside the poll. For a reader that acts on it
   * while the window is hidden (a media key that skips or seeks), when the
   * last one polled can be ten seconds old.
   *
   * Callers that overlap share one question, so each of them resumes with the
   * fresh position. A status that arrives meanwhile drops the reply (see
   * `#askPosition`), and the question is asked again.
   */
  syncPosition(): Promise<void> {
    this.#syncing ??= this.#sync().finally(() => (this.#syncing = null));
    return this.#syncing;
  }

  async #sync(): Promise<void> {
    for (let tries = 0; tries < SYNC_TRIES; tries++) {
      if (this.#seeking || !this.#loaded) return;
      this.#stopPolling();
      if ((await this.#askPosition()) !== "superseded") return;
    }
  }

  /**
   * Hidden, the next poll is the slow one. Shown again, the position is asked
   * for at once, paused or playing, so the bar is right when it is first drawn.
   * Not while a song loads: mpv may still answer with the last one's.
   */
  #onHidden(hidden: boolean): void {
    this.#hidden = hidden;
    if (!hidden && this.#loaded && !this.#seeking) this.#pollIn(0);
  }

  /**
   * The core only pushes the position when a song starts, after a seek, on a
   * pause and when the song ends.
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

  async #askPosition(): Promise<"delivered" | "empty" | "superseded"> {
    this.#poll = null;
    const asked = this.#asked;
    let position: Position | null = null;
    let failed = false;
    try {
      position = await call("playerPosition");
    } catch (error) {
      failed = true;
      console.error("could not read the playback position", error);
    }
    // A pause, a seek or a new song since the question bumps `#asked`, and the
    // reply is dropped: whatever bumped it starts the polling again if it
    // should run.
    if (this.#seeking || asked !== this.#asked) return "superseded";
    if (!position) {
      // Nothing loaded: the next "playing" status starts the polling again. A
      // question that failed is asked again, or one lost reply would end the
      // polling for the rest of the song.
      if (failed && this.#playing) this.#pollIn(this.#hidden ? HIDDEN_POLL_MS : 1000);
      return "empty";
    }
    this.#deliver({ type: "position", ...position });
    if (!this.#playing) return "delivered";
    // Just after the next whole second, so the time label ticks on time.
    this.#pollIn(this.#hidden ? HIDDEN_POLL_MS : 1000 - (position.positionMs % 1000) + 20);
    return "delivered";
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
