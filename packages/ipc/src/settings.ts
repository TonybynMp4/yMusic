import type { AudioQuality as CoreAudioQuality } from "@ymusic/core";

import { type AudioQuality, defaultSettings as rustDefaults } from "./bindings.ts";
import type { Settings, SettingsPatch } from "./bindings.ts";
import { call, isTauri, type Same } from "./tauri.ts";

export type { SearchHistory, Settings, SettingsPatch, StableVolume } from "./bindings.ts";

/** The engine picks streams by core's quality; Rust saves this one. */
const qualitiesMatch: Same<AudioQuality, CoreAudioQuality> = true;
void qualitiesMatch;

/**
 * Rust's `Settings::default()`, generated with the bindings. What a plain
 * browser gets, where there is no file to read.
 */
export const defaultSettings: Settings = rustDefaults;

export async function settingsGet(): Promise<Settings> {
  if (!isTauri) return defaultSettings;
  return call("settingsGet");
}

/** Changes the settings in `patch`, saves them, and returns all of them. */
export async function settingsSet(patch: SettingsPatch): Promise<Settings> {
  return call("settingsSet", patch);
}
