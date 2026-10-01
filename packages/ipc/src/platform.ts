import { z } from "zod";
import { invokeParsed, invokeVoid } from "./tauri.ts";

export const InstallFlavor = z.enum(["deb", "windows-installer", "unknown"]);
export type InstallFlavor = z.infer<typeof InstallFlavor>;

export const PlatformSummary = z.object({
  os: z.string(),
  arch: z.string(),
  appVersion: z.string(),
  installFlavor: InstallFlavor,
  /**
   * False when the build cannot install an update itself: a hand-run binary,
   * or a `.deb` on a desktop with no polkit. The UI links to a download
   * instead of offering a button that cannot work.
   */
  supportsInAppUpdate: z.boolean(),
  /**
   * False on Linux without libayatana-appindicator, where "keep playing in
   * the tray" would quit on close anyway.
   */
  hasTray: z.boolean(),
});
export type PlatformSummary = z.infer<typeof PlatformSummary>;

export function platformSummary(): Promise<PlatformSummary> {
  return invokeParsed("platform_summary", PlatformSummary);
}

export const Update = z.object({
  version: z.string(),
  /** The release page on GitHub. */
  url: z.url(),
  prerelease: z.boolean(),
});
export type Update = z.infer<typeof Update>;

/** A release newer than this build, or null. Prereleases count when the settings say so. */
export function updateCheck(): Promise<Update | null> {
  return invokeParsed("update_check", Update.nullable());
}

export function openLogsFolder(): Promise<void> {
  return invokeVoid("open_logs_folder");
}
