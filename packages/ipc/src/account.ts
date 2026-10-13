import { z } from "zod";

import { invokeParsed, invokeVoid, isTauri } from "./tauri.ts";

const Cookie = z.string().nullable();

/** The saved session's cookie header, or null when signed out. */
export async function accountCookie(): Promise<string | null> {
  if (!isTauri) return null;
  return invokeParsed("account_cookie", Cookie);
}

/**
 * Opens Google's sign-in in its own window and resolves with the session once
 * it lands on YouTube Music. Null means the user closed the window.
 */
export async function accountSignIn(): Promise<string | null> {
  return invokeParsed("account_sign_in", Cookie);
}

const Browsers = z.array(z.object({ id: z.string(), name: z.string() }));
export type Browser = z.infer<typeof Browsers>[number];

/** Browser profiles on this machine that a session can be imported from. */
export async function accountBrowsers(): Promise<Browser[]> {
  if (!isTauri) return [];
  return invokeParsed("account_browsers", Browsers);
}

/** Takes the YouTube session from one of `accountBrowsers()` and keeps it. */
export async function accountImport(id: string): Promise<string> {
  return invokeParsed("account_import", z.string(), { id });
}

/**
 * A fresher copy of the session, for when YouTube stops accepting `stale`: one
 * saved since, read again from its browser if imported, or rotated if not.
 * Null when none of those gives anything newer.
 */
export async function accountRefresh(stale: string): Promise<string | null> {
  return invokeParsed("account_refresh", Cookie, { stale });
}

/**
 * Rotates a session from the sign-in window, which nothing else keeps alive.
 * Null for an imported session, or when the rotation did not take.
 */
export async function accountRotate(): Promise<string | null> {
  return invokeParsed("account_rotate", Cookie);
}

export async function accountSignOut(): Promise<void> {
  return invokeVoid("account_sign_out");
}
