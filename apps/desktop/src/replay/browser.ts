import { defaultSettings, fullVolume, type Settings } from "@ymusic/ipc";

/** Settings changed in this tab, so a toggle on the settings page holds. */
let settings: Settings = defaultSettings;

/** Starts this tab's settings from a recorded copy. */
export function seedSettings(recorded: Settings): void {
  settings = recorded;
}

/**
 * What a plain browser answers for a Rust command nobody recorded: an empty
 * value of the right shape, so the app looks like a fresh install. Commands
 * that only tell the core something get null. The few with no empty shape
 * fail, as they may in the app, and their callers already cope.
 */
export function browserAnswer(cmd: string, args: unknown): Promise<unknown> {
  switch (cmd) {
    case "settings_get":
      return Promise.resolve(settings);
    case "settings_set":
      settings = { ...settings, ...(args as { patch: Partial<Settings> }).patch } as Settings;
      return Promise.resolve(settings);
    case "player_saved_volume":
      return Promise.resolve(fullVolume);
    case "queue_load":
      return Promise.resolve({ queue: null, position: null });
    case "account_browsers":
    case "library_folders":
    case "library_tracks":
    case "library_search":
    case "player_audio_devices":
      return Promise.resolve([]);
    case "autostart_get":
      return Promise.resolve(false);
    case "cache_size":
      return Promise.resolve(0);
    case "platform_summary":
    case "library_scan":
    case "library_resolve":
    case "account_import":
      return Promise.reject(new Error(`\`${cmd}\` needs the app`));
    default:
      return Promise.resolve(null);
  }
}

/** The parts of a `RequestHead`/`ResponseHead` the dev server passes along. */
export interface WireRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
}

export interface WireResponse {
  status: number;
  statusText: string;
  url: string;
  headers: [string, string][];
  body: string;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}
