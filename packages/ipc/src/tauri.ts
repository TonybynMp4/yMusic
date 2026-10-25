/**
 * The only module in the repo that talks to Tauri directly, through the
 * commands generated from Rust into `bindings.ts`.
 *
 * Calls degrade instead of throwing when there is no app webview: plain
 * `vite dev` is a useful loop for UI work. Payloads are not parsed here. Rust
 * is the source of their types, and `bindings.ts` is regenerated and checked
 * against it in `cargo test`, so a drifted shape fails the build instead.
 */

import type { TrackId } from "@ymusic/core";

import { commands } from "./bindings.ts";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export class NotInTauriError extends Error {
  constructor(command: string) {
    super(`\`${command}\` needs the Tauri app webview; this is a plain browser.`);
    this.name = "NotInTauriError";
  }
}

type Commands = typeof commands;

/** Calls a generated command, or rejects with `NotInTauriError` outside the app. */
export async function call<K extends keyof Commands>(
  command: K,
  ...args: Parameters<Commands[K]>
): Promise<Awaited<ReturnType<Commands[K]>>> {
  if (!isTauri) throw new NotInTauriError(command);
  const run = commands[command] as (
    ...args: Parameters<Commands[K]>
  ) => Promise<Awaited<ReturnType<Commands[K]>>>;
  return run(...args);
}

/**
 * A track id that came back from Rust. Rust only ever echoes ids the frontend
 * sent or ones it minted as `local:<hash>`, so the brand is restored, not
 * checked.
 */
export function rustTrackId(id: string): TrackId {
  return id as TrackId;
}

/**
 * True when `A` and `B` are the same type. A Rust type mirrored by a schema in
 * `@ymusic/core`, which also parses YouTube's data, is pinned with it, so the
 * two cannot drift apart without failing `tsc`.
 */
export type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
