/**
 * Tauri access that degrades instead of throwing.
 *
 * The Tauri APIs assume they are running inside the app's webview and throw at
 * call time when they are not. Plain `vite dev` in a browser is genuinely
 * useful for iterating on the UI, and one throw from a titlebar button should
 * not take the whole tree down, so every call goes through here.
 */

export const isTauri = "__TAURI_INTERNALS__" in window;

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

type WindowAction = "minimize" | "toggleMaximize" | "close";

export async function windowAction(action: WindowAction): Promise<void> {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow()[action]();
}
