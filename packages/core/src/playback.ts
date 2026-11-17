import type { StreamLease, TrackId } from "./domain.ts";

/**
 * The seam between the queue and whatever actually makes sound. libmpv on
 * desktop today; a platform player on mobile later, where libmpv is too heavy
 * to be worth it. Nothing above this interface knows which one it is talking to.
 */
export interface PlaybackEngine {
  /**
   * Starts playing once loaded, unless `paused`. `startMs` starts it part
   * way in, for a queue restored at launch. `attempt` is 2 for the retry on
   * another player client after the first lease was refused, and only logged.
   */
  load(lease: StreamLease, paused?: boolean, startMs?: number, attempt?: number): Promise<void>;
  /**
   * The track to go on to with no gap when `after` ends, or null to take it
   * back. Ignored once `after` is no longer playing. When the engine goes on
   * to it, it reports `advanced` instead of `ended`.
   */
  queueNext(after: TrackId, lease: StreamLease | null): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (event: PlaybackEvent) => void): () => void;
}

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "ended";

export type PlaybackEvent =
  | { type: "status"; status: PlaybackStatus }
  | { type: "position"; positionMs: number; durationMs: number | null }
  | { type: "ended"; trackId: TrackId | null }
  | { type: "advanced"; trackId: TrackId }
  | { type: "error"; trackId: TrackId | null; message: string };
