import type { PlatformSummary, Update } from "./bindings.ts";
import { call } from "./tauri.ts";

export type { InstallFlavor, PlatformSummary, Update } from "./bindings.ts";

/**
 * Where the app runs. `supportsInAppUpdate` is false when the build cannot
 * install an update itself (a hand-run binary, or a `.deb` on a desktop with
 * no polkit), so the UI links to a download instead of offering a button that
 * cannot work. `hasTray` is false on Linux without libayatana-appindicator,
 * where "keep playing in the tray" would quit on close anyway.
 */
export async function platformSummary(): Promise<PlatformSummary> {
  return call("platformSummary");
}

/**
 * A release newer than this build, or null. Prereleases count when the
 * settings say so. `url` is the release page on GitHub.
 */
export async function updateCheck(): Promise<Update | null> {
  return call("updateCheck");
}

export async function openLogsFolder(): Promise<void> {
  await call("openLogsFolder");
}

/** How many bytes the artwork cache takes on disk, the only cache with a size to show. */
export async function cacheSize(): Promise<number> {
  return call("cacheSize");
}

/**
 * Deletes the cached artwork and empties the webview's memory and disk caches.
 * Cookies, storage, settings and the account stay.
 */
export async function cacheClear(): Promise<void> {
  await call("cacheClear");
}
