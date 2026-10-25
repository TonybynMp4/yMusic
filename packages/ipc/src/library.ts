/**
 * The local music library, as the UI sees it.
 *
 * Rust returns a flat `LocalTrack` row; this module lifts it into the shared
 * `Track` domain model so a local track and a YouTube track are the same thing
 * everywhere above this line. The lift is the whole point of the module -- it
 * is the only place that knows local tracks have a filesystem path.
 */

import type {
  AudioCodec as CoreAudioCodec,
  TrackId,
  StreamLease,
  Thumbnail,
  Track,
} from "@ymusic/core";

import type {
  AudioCodec,
  CoverArt,
  LocalLease,
  LocalTrack as LocalTrackRow,
  ScanReport,
} from "./bindings.ts";
import { call, rustTrackId, type Same } from "./tauri.ts";

export type { ScanFailure, ScanReport } from "./bindings.ts";

/** A local lease plays through the same path as a YouTube one. */
const codecsMatch: Same<AudioCodec, CoreAudioCodec> = true;
void codecsMatch;

/** A library track plus the local-only details the library view shows. */
export interface LocalTrack extends Track {
  path: string;
  albumArtist: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  /** When the file was first scanned, in milliseconds since the Unix epoch. */
  addedAt: number;
}

/**
 * Cover art lives outside the bundle, so the webview cannot load it from a
 * plain path. `convertFileSrc` rewrites it to the asset protocol, which is
 * scoped to the art cache directory in `tauri.conf.json`.
 */
async function artUrl(path: string): Promise<string> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(path);
}

/**
 * The inverse of `artUrl`: the file path behind an asset-protocol URL, or null
 * for anything else. The OS media session needs the file, not the webview's
 * view of it. Both spellings are matched because `convertFileSrc` writes
 * `asset://localhost/` on Linux and `http(s)://asset.localhost/` on Windows.
 */
export function localPathFromArtUrl(url: string): string | null {
  const match = /^(?:asset:\/\/localhost\/|https?:\/\/asset\.localhost\/)(.+)$/.exec(url);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function toThumbnails(art: CoverArt | null): Promise<Thumbnail[]> {
  if (!art) return [];
  return [
    {
      url: await artUrl(art.path),
      // Fall back to a square when the header could not be parsed; the
      // numbers only drive layout, never decoding.
      width: art.width || 300,
      height: art.height || 300,
    },
  ];
}

async function toTrack(row: LocalTrackRow): Promise<LocalTrack> {
  const thumbnails = await toThumbnails(row.coverArt);

  return {
    id: rustTrackId(row.id),
    title: row.title,
    artists: [{ name: row.artist, channelId: null }],
    album: row.album,
    albumId: null,
    durationMs: row.durationMs,
    thumbnails,
    isExplicit: false,
    path: row.path,
    albumArtist: row.albumArtist,
    trackNumber: row.trackNumber,
    discNumber: row.discNumber,
    year: row.year,
    addedAt: row.addedAt * 1000,
  };
}

export async function libraryFolders(): Promise<string[]> {
  return call("libraryFolders");
}

/** The cover image at the top of a library folder, or none. Songs never use it. */
export async function libraryFolderCover(path: string): Promise<Thumbnail[]> {
  return toThumbnails(await call("libraryFolderCover", path));
}

/** Registers the folder and scans it in one step. */
export async function libraryAddFolder(path: string): Promise<ScanReport> {
  return call("libraryAddFolder", path);
}

export async function libraryRemoveFolder(path: string): Promise<void> {
  await call("libraryRemoveFolder", path);
}

export async function libraryScan(): Promise<ScanReport> {
  return call("libraryScan");
}

export async function libraryTracks(): Promise<LocalTrack[]> {
  return Promise.all((await call("libraryTracks")).map(toTrack));
}

/** Blank query returns everything, matching the Rust side. */
export async function librarySearch(query: string): Promise<LocalTrack[]> {
  return Promise.all((await call("librarySearch", query)).map(toTrack));
}

/**
 * Resolves a local track to a lease. Same signature shape as the YouTube
 * resolver, so the player never branches on where a track came from.
 */
export async function libraryResolve(id: TrackId): Promise<StreamLease> {
  return toStreamLease(await call("libraryResolve", id));
}

/** Rust's lease is core's `StreamLease` with the track id unbranded. */
export function toStreamLease(lease: LocalLease): StreamLease {
  return { ...lease, trackId: rustTrackId(lease.trackId) };
}

/** Opens the native folder picker. Null when the user cancels. */
export async function pickMusicFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const chosen = await open({ directory: true, multiple: false, title: "Add music folder" });
  return typeof chosen === "string" ? chosen : null;
}

/** Opens a library folder in the system file manager. */
export async function libraryOpenFolder(path: string): Promise<void> {
  await call("libraryOpenFolder", path);
}

/** Shows a local track's file in the system file manager, selected. */
export async function libraryReveal(id: TrackId): Promise<void> {
  await call("libraryReveal", id);
}
