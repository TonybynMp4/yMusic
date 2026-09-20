import { isTauri } from "./tauri.ts";

/**
 * The fetch that reaches YouTube.
 *
 * InnerTube sends no CORS headers, so the webview's own `fetch` never gets the
 * response — the request is blocked as a cross-origin read before anything
 * comes back. Tauri's HTTP plugin performs the request in Rust instead, where
 * the same-origin policy does not apply, and it is scoped to the YouTube hosts
 * in `capabilities/default.json` so this is not a general-purpose hole.
 *
 * Outside the app webview it falls back to the platform fetch, which keeps
 * Node tests and probe scripts on exactly the same code path.
 */
export async function appFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!isTauri) return globalThis.fetch(input, init);
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  return tauriFetch(input, init);
}
