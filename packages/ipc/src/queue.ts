import { Track, VideoId } from "@ymusic/core";
import { z } from "zod";

import { invokeParsed, invokeVoid, isTauri } from "./tauri.ts";

/**
 * The queue as saved in `queue.json`. Rust stores it as it comes, so this
 * schema is its only check: a file that fails it reads as nothing saved.
 */
export const SavedQueue = z.object({
  items: z.array(Track).readonly(),
  order: z.array(z.number().int().nonnegative()).readonly(),
  cursor: z.number().int().nonnegative(),
  repeat: z.enum(["off", "all", "one"]),
  shuffle: z.boolean(),
  /** The YouTube playlist the queue was started from, which sharing names. */
  playlistId: z.string().nullable(),
  /**
   * What this device last wrote to the account's server queue, and which
   * account it was. Kept when the queue changes without playing anything.
   */
  shared: z
    .object({ account: z.string(), videoId: VideoId, playlistId: z.string().nullable() })
    .nullable(),
});
export type SavedQueue = z.infer<typeof SavedQueue>;

/** How far into the playing song playback was. */
export const QueuePosition = z.object({
  trackId: z.string(),
  positionMs: z.number().int().nonnegative(),
});
export type QueuePosition = z.infer<typeof QueuePosition>;

const Saved = z.object({
  queue: z.unknown().nullable(),
  position: QueuePosition.nullable(),
});

/** What the last run saved. Nothing outside Tauri, or when the file does not parse. */
export async function queueLoad(): Promise<{
  queue: SavedQueue | null;
  position: QueuePosition | null;
}> {
  if (!isTauri) return { queue: null, position: null };
  const saved = await invokeParsed("queue_load", Saved);
  const queue = SavedQueue.safeParse(saved.queue);
  if (saved.queue !== null && !queue.success) {
    console.error("ignoring the saved queue", queue.error);
  }
  return { queue: queue.success ? queue.data : null, position: saved.position };
}

/** Replaces the saved queue. Null clears it. */
export async function queueSave(queue: SavedQueue | null): Promise<void> {
  if (!isTauri) return;
  await invokeVoid("queue_save", { queue });
}

export async function queueSavePosition(position: QueuePosition): Promise<void> {
  if (!isTauri) return;
  await invokeVoid("queue_save_position", { position });
}
