import { AudioQuality } from "@ymusic/core";
import { z } from "zod";

import { invokeParsed, isTauri } from "./tauri.ts";

/**
 * Mirrors `settings::Settings` in Rust. The defaults match Rust's too, and are
 * what a plain browser gets, where there is no file to read.
 */
export const Settings = z.object({
  autoplay: z.boolean().default(true),
  audioQuality: AudioQuality.default("high"),
  stableVolume: z.boolean().default(false),
  /** An mpv `audio-device` name; `auto` follows the system's default output. */
  audioDevice: z.string().default("auto"),
  skipDisliked: z.boolean().default(false),
  pauseWatchHistory: z.boolean().default(false),
  pauseSearchHistory: z.boolean().default(false),
  closeToTray: z.boolean().default(false),
  checkForUpdates: z.boolean().default(true),
  includePrereleases: z.boolean().default(false),
});
export type Settings = z.infer<typeof Settings>;

export const defaultSettings: Settings = Settings.parse({});

export async function settingsGet(): Promise<Settings> {
  if (!isTauri) return defaultSettings;
  return invokeParsed("settings_get", Settings);
}

/** Changes the settings in `patch`, saves them, and returns all of them. */
export async function settingsSet(patch: Partial<Settings>): Promise<Settings> {
  return invokeParsed("settings_set", Settings, { patch });
}
