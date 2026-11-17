import type { Innertube } from "youtubei.js";
import { radioArtist, type RadioChip, type RadioCover } from "@ymusic/core";

import { toThumbnails, type RawThumbnail } from "./thumbnails.ts";

/** The raw `/next` answer for a mix, as YouTube Music's own "Start mix" asks for it. */
async function nextOf(youtube: Innertube, playlistId: string): Promise<unknown> {
  const response = await youtube.actions.execute("/next", {
    playlistId,
    params: "wAEB",
    client: "YTMUSIC",
  });
  return response.data;
}

/**
 * The tuning chips above the queue of a mix or radio ("All", "Popular",
 * "Chill", "2010s"), each a radio to play instead. Empty when YouTube offers
 * none.
 */
export async function getRadioChips(youtube: Innertube, playlistId: string): Promise<RadioChip[]> {
  return radioChipsFrom(await nextOf(youtube, playlistId));
}

/**
 * The artist an artist's mix (`RDEM…`) is seeded with, as a tuned radio names
 * it, or null when YouTube offers no tuning for it.
 *
 * Search results and artist pages never carry the Knowledge Graph id a tuned
 * radio needs. The up-next panel of the artist's mix does: its tuning chips
 * (Popular, Discover, Deep cuts) are tuned radios of that one artist.
 */
export async function getRadioArtist(youtube: Innertube, mixId: string): Promise<string | null> {
  return radioArtistFrom(await nextOf(youtube, mixId));
}

/** Exported for tests: the first chip id in the answer that names one artist. */
export function radioArtistFrom(data: unknown): string | null {
  for (const chip of radioChipsFrom(data)) {
    const artist = radioArtist(chip.playlistId);
    if (artist !== null) return artist;
  }
  return null;
}

/**
 * Exported for tests. Only chips that queue a playlist: the "Save" chip next
 * to them opens a dialog instead.
 */
export function radioChipsFrom(data: unknown): RadioChip[] {
  const chips: RadioChip[] = [];
  const seen = new Set<string>();
  for (const chip of chipRenderers(data)) {
    const title = text(chip.text);
    const command = chip.navigationEndpoint?.queueUpdateCommand;
    const playlistId = command ? findPlaylistId(command) : null;
    if (!title || playlistId === null || seen.has(playlistId)) continue;
    seen.add(playlistId);
    chips.push({ title, playlistId });
  }
  return chips;
}

interface RawChip {
  text?: RawRuns;
  navigationEndpoint?: { queueUpdateCommand?: unknown };
}

function* chipRenderers(node: unknown): Generator<RawChip> {
  if (Array.isArray(node)) {
    for (const item of node) yield* chipRenderers(item);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "chipCloudChipRenderer") {
      if (value !== null && typeof value === "object") yield value as RawChip;
    } else {
      yield* chipRenderers(value);
    }
  }
}

function findPlaylistId(node: unknown): string | null {
  if (node === null || typeof node !== "object") return null;
  for (const [key, value] of Object.entries(node)) {
    if (key === "playlistId" && typeof value === "string") return value;
    const found = findPlaylistId(value);
    if (found !== null) return found;
  }
  return null;
}

interface RawRuns {
  runs?: readonly { text?: unknown }[];
}

interface RawRadioPage {
  contents?: {
    twoColumnBrowseResultsRenderer?: {
      tabs?: readonly {
        tabRenderer?: {
          content?: {
            sectionListRenderer?: {
              contents?: readonly {
                musicResponsiveHeaderRenderer?: {
                  title?: RawRuns;
                  subtitle?: RawRuns;
                  thumbnail?: {
                    musicThumbnailRenderer?: {
                      thumbnail?: { thumbnails?: readonly RawThumbnail[] };
                    };
                  };
                };
              }[];
            };
          };
        };
      }[];
    };
  };
}

/**
 * The name and cover YouTube Music gives a tuned radio, from its page
 * (`VL` + the playlist id). The cover is drawn by YouTube from the seeds, on
 * `music.youtube.com/image/radioart`. Null when the page has no header, as for
 * a radio YouTube cannot make.
 */
export async function getRadioCover(
  youtube: Innertube,
  playlistId: string,
): Promise<RadioCover | null> {
  const response = await youtube.actions.execute("/browse", {
    browseId: `VL${playlistId}`,
    client: "YTMUSIC",
  });
  return radioCoverFrom(response.data);
}

/** Exported for tests. */
export function radioCoverFrom(data: unknown): RadioCover | null {
  const tab = (data as RawRadioPage | null)?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
    ?.tabRenderer;
  const sections = tab?.content?.sectionListRenderer?.contents ?? [];
  const header = sections.find(
    (s) => s.musicResponsiveHeaderRenderer,
  )?.musicResponsiveHeaderRenderer;
  const title = text(header?.title);
  if (!header || !title) return null;
  return {
    title,
    subtitle: text(header.subtitle),
    thumbnails: toThumbnails(header.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
  };
}

function text(runs: RawRuns | undefined): string {
  return (runs?.runs ?? []).map((run) => (typeof run.text === "string" ? run.text : "")).join("");
}
