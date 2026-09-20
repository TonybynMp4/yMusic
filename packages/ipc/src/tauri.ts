/**
 * The only module in the repo that talks to Tauri directly.
 *
 * Two things it guarantees for everything above it: calls degrade instead of
 * throwing when there is no app webview (plain `vite dev` is a useful loop for
 * UI work), and every payload crossing the Rust boundary is parsed by a zod
 * schema rather than trusted.
 */

import type { z } from "zod";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export class NotInTauriError extends Error {
  constructor(command: string) {
    super(`\`${command}\` needs the Tauri app webview; this is a plain browser.`);
    this.name = "NotInTauriError";
  }
}

export async function invokeParsed<T extends z.ZodType>(
  command: string,
  schema: T,
  args?: Record<string, unknown>,
): Promise<z.infer<T>> {
  if (!isTauri) throw new NotInTauriError(command);
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke(command, args);
  const result = schema.safeParse(raw);
  if (!result.success) {
    // A Rust command whose shape drifted from its schema is a build-time
    // mistake, so say which command rather than letting it surface later as a
    // missing field in a component.
    throw new Error(`\`${command}\` returned an unexpected shape: ${result.error.message}`);
  }
  return result.data;
}

/** Fire-and-forget commands that return nothing but can still fail in Rust. */
export async function invokeVoid(
  command: string,
  args?: Record<string, unknown>,
): Promise<void> {
  if (!isTauri) throw new NotInTauriError(command);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(command, args);
}
