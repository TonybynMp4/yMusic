import { useSyncExternalStore } from "react";
import { windowHidden } from "@ymusic/ipc";

/**
 * Whether the main window is hidden in the tray. The page keeps running then,
 * so anything only a visible window needs can stop while this is true.
 */
export function useWindowHidden(): boolean {
  return useSyncExternalStore(windowHidden.subscribe, windowHidden.get);
}
