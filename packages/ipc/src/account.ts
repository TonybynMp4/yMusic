import type { Browser } from "./bindings.ts";
import { call, isTauri } from "./tauri.ts";

export type { Browser } from "./bindings.ts";

/** The saved session's cookie header, or null when signed out. */
export async function accountCookie(): Promise<string | null> {
  if (!isTauri) return null;
  return call("accountCookie");
}

/**
 * Opens Google's sign-in in its own window and resolves with the session once
 * it lands on YouTube Music. Null means the user closed the window.
 */
export async function accountSignIn(): Promise<string | null> {
  return call("accountSignIn");
}

/** Browser profiles on this machine that a session can be imported from. */
export async function accountBrowsers(): Promise<Browser[]> {
  if (!isTauri) return [];
  return call("accountBrowsers");
}

/** Takes the YouTube session from one of `accountBrowsers()` and keeps it. */
export async function accountImport(id: string): Promise<string> {
  return call("accountImport", id);
}

/**
 * A fresher copy of the session, for when YouTube stops accepting `stale`: one
 * saved since, read again from its browser if imported, or rotated if not.
 * Null when none of those gives anything newer.
 */
export async function accountRefresh(stale: string): Promise<string | null> {
  return call("accountRefresh", stale);
}

/**
 * Rotates a session from the sign-in window, which nothing else keeps alive.
 * Null for an imported session, or when the rotation did not take.
 */
export async function accountRotate(): Promise<string | null> {
  return call("accountRotate");
}

export async function accountSignOut(): Promise<void> {
  await call("accountSignOut");
}
