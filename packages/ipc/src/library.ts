/**
 * The local music library, as the UI sees it.
 *
 * Rust returns a flat `LocalTrack` row; this module lifts it into the shared
 * `Track` domain model so a local track and a YouTube track are the same thing
 * everywhere above this line. The lift is the whole point of the module -- it
 * is the only place that knows local tracks have a filesystem path.
 */

import { AudioCodec, StreamLease, type Track, TrackId } from "@ymusic/core";
import { z } from "zod";

import { invokeParsed, invokeVoid } from "./tauri.ts";

const CoverArt = z.object({
  path: z.string(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});

/** The raw row as Rust serialises it. Not exported: callers want `Track`. */
const LocalTrackRow = z.object({
  id: TrackId,
  path: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().nullable(),
  albumArtist: z.string().nullable(),
  trackNumber: z.number().int().nullable(),
  discNumber: z.number().int().nullable(),
  year: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  codec: AudioCodec,
  bitrate: z.number().int().positive().nullable(),
  coverArt: CoverArt.nullable(),
});
type LocalTrackRow = z.infer<typeof LocalTrackRow>;

/** A library track plus the local-only details the library view shows. */
export interface LocalTrack extends Track {
  path: string;
  albumArtist: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  year: number | null;
}

export const ScanFailure = z.object({ path: z.string(), reason: z.string() });
export type ScanFailure = z.infer<typeof ScanFailure>;

export const ScanReport = z.object({
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  failed: z.array(ScanFailure),
});
export type ScanReport = z.infer<typeof ScanReport>;

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

async function toTrack(row: LocalTrackRow): Promise<LocalTrack> {
  const thumbnails = row.coverArt
    ? [
        {
          url: await artUrl(row.coverArt.path),
          // Fall back to a square when the header could not be parsed; the
          // numbers only drive layout, never decoding.
          width: row.coverArt.width || 300,
          height: row.coverArt.height || 300,
        },
      ]
    : [];

  return {
    id: row.id,
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
  };
}

const LocalTrackRows = z.array(LocalTrackRow);

export async function libraryFolders(): Promise<string[]> {
  return invokeParsed("library_folders", z.array(z.string()));
}

/** Registers the folder and scans it in one step. */
export async function libraryAddFolder(path: string): Promise<ScanReport> {
  return invokeParsed("library_add_folder", ScanReport, { path });
}

export async function libraryRemoveFolder(path: string): Promise<void> {
  return invokeVoid("library_remove_folder", { path });
}

export async function libraryScan(): Promise<ScanReport> {
  return invokeParsed("library_scan", ScanReport);
}

export async function libraryTracks(): Promise<LocalTrack[]> {
  const rows = await invokeParsed("library_tracks", LocalTrackRows);
  return Promise.all(rows.map(toTrack));
}

/** Blank query returns everything, matching the Rust side. */
export async function librarySearch(query: string): Promise<LocalTrack[]> {
  const rows = await invokeParsed("library_search", LocalTrackRows, { query });
  return Promise.all(rows.map(toTrack));
}

/**
 * Resolves a local track to a lease. Same signature shape as the eventual
 * YouTube resolver, so the player never branches on where a track came from.
 */
export async function libraryResolve(id: TrackId): Promise<StreamLease> {
  return invokeParsed("library_resolve", StreamLease, { id });
}

/** Opens the native folder picker. Null when the user cancels. */
export async function pickMusicFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const chosen = await open({ directory: true, multiple: false, title: "Add music folder" });
  return typeof chosen === "string" ? chosen : null;
}
