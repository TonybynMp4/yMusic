import type { StreamLease, TrackId } from "./domain.ts";

/**
 * The seam between the queue and whatever actually makes sound. libmpv on
 * desktop today; a platform player on mobile later, where libmpv is too heavy
 * to be worth it. Nothing above this interface knows which one it is talking to.
 */
export interface PlaybackEngine {
  load(lease: StreamLease): Promise<void>;
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
  | { type: "ended"; trackId: TrackId }
  | { type: "error"; trackId: TrackId | null; message: string };
