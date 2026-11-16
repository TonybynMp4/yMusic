/**
 * Whether the main window is hidden in the tray.
 *
 * The page keeps running while it is, because the queue and the engine live
 * here. Rust says when the window is hidden and shown, since it is the one
 * that does both. `visibilitychange` is not used: what a hidden window reports
 * differs between WebKitGTK and WebView2.
 */

import { Channel } from "@tauri-apps/api/core";

import type { Visibility } from "./bindings.ts";
import { call, isTauri } from "./tauri.ts";

/** Shaped for `useSyncExternalStore`. */
export interface WindowHiddenStore {
  get(): boolean;
  subscribe(listener: () => void): () => void;
}

/** Exported for tests: the app uses `windowHidden`. */
export function createWindowHidden(): WindowHiddenStore {
  let hidden = false;
  let opened = false;
  const listeners = new Set<() => void>();

  // One channel for the page, opened by the first subscriber. Rust keeps a
  // single sink, so a second channel would cut the first one off.
  function open(): void {
    if (opened || !isTauri) return;
    opened = true;
    const channel = new Channel<Visibility>();
    channel.onmessage = (visibility) => {
      const next = visibility === "hidden";
      if (next === hidden) return;
      hidden = next;
      for (const listener of listeners) listener();
    };
    call("windowSubscribe", channel).catch((error: unknown) =>
      console.error("could not subscribe to the window's visibility", error),
    );
  }

  return {
    get: () => hidden,
    subscribe(listener) {
      open();
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** False outside Tauri, where there is no tray to hide in. */
export const windowHidden: WindowHiddenStore = createWindowHidden();
