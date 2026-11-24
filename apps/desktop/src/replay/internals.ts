/**
 * Gives a plain browser the IPC the app webview has, before anything reads
 * it. `@ymusic/ipc` decides `isTauri` once, when it is first evaluated, so
 * this module must be the first import of whichever entry uses it: ES
 * modules evaluate their imports in order.
 *
 * Inside the app webview Tauri's own IPC is already there and this does
 * nothing.
 */

import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";

type Handler = (cmd: string, args: unknown) => Promise<unknown>;

/** True when this is a browser given a stand-in for the app's IPC. */
export const mocked = !("__TAURI_INTERNALS__" in window);

let handler: Handler = (cmd) => Promise.reject(new Error(`no IPC handler for ${cmd} yet`));

/** Sets what the stand-in IPC answers with. */
export function handleIpc(next: Handler): void {
  handler = next;
}

if (mocked) {
  mockWindows("main");
  mockConvertFileSrc("linux");
  mockIPC((cmd, args) => handler(cmd, args), { shouldMockEvents: true });
  // Artwork goes through the app's `img` scheme, which only the app serves.
  // Google's image hosts answer a browser directly.
  const convert = window.__TAURI_INTERNALS__.convertFileSrc;
  window.__TAURI_INTERNALS__.convertFileSrc = (path: string, protocol?: string) =>
    protocol === "img" ? path : convert(path, protocol);
}

declare global {
  interface Window {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
      convertFileSrc: (path: string, protocol?: string) => string;
    };
  }
}
