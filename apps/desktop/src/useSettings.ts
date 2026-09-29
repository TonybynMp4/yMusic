import { useCallback, useState } from "react";
import { isTauri, settingsGet, settingsSet, type Settings } from "@ymusic/ipc";

export interface SettingsState {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

/**
 * The settings, saved in Rust. `initial` is read before the app first renders,
 * so nothing starts on the defaults and then changes its mind: a resumed song
 * must not reach the watch history while that is paused.
 *
 * A change shows at once and is then saved. If saving fails, the saved
 * settings are read back, so the page never shows one the app is not using.
 */
export function useSettings(initial: Settings): SettingsState {
  const [settings, setSettings] = useState(initial);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    // A plain browser has no file to save to; the change lasts until reload.
    if (!isTauri) return;
    settingsSet(patch).then(setSettings, (error: unknown) => {
      console.error("could not save settings", error);
      void settingsGet().then(setSettings);
    });
  }, []);
  return { settings, update };
}
