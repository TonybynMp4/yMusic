import { z } from "zod";
import { invokeParsed } from "./tauri.ts";

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
});
export type PlatformSummary = z.infer<typeof PlatformSummary>;

export function platformSummary(): Promise<PlatformSummary> {
  return invokeParsed("platform_summary", PlatformSummary);
}
