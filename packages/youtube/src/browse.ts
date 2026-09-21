import {
  AlbumPage,
  ArtistPage,
  type Artist,
  BrowseCard,
  PlaylistPage,
  type Thumbnail,
  type Track,
} from "@ytbm/core";
import type { Innertube } from "youtubei.js";

import { toArtists, toTrack, type RawSong } from "./parse.ts";
import { toThumbnails, type RawThumbnail } from "./thumbnails.ts";

/**
 * Album, artist and playlist pages from YouTube Music.
 *
 * Same stance as `parse.ts`: youtubei.js's objects are read structurally,
 * through the few fields used here, and a row that does not fit is dropped
 * rather than failing the page.
 */

/** Anything youtubei.js renders as text: a `Text` with runs, or a plain string. */
interface RawText {
  toString(): string;
  runs?: readonly { text?: unknown; endpoint?: RawEndpoint | null }[] | null;
}

interface RawEndpoint {
  payload?: { browseId?: unknown } | null;
}

interface RawHeader {
  title?: RawText | null;
  subtitle?: RawText | null;
  second_subtitle?: RawText | null;
  strapline_text_one?: RawText | null;
  description?: RawText | null;
  thumbnail?: { contents?: readonly RawThumbnail[] | null } | null;
  thumbnails?: readonly RawThumbnail[] | null;
}

interface RawCard {
  id?: unknown;
  item_type?: unknown;
  title?: RawText | string | null;
  subtitle?: RawText | null;
  thumbnail?: readonly RawThumbnail[] | null;
  endpoint?: RawEndpoint | null;
}

interface RawSection {
  type?: unknown;
  title?: RawText | null;
  header?: { title?: RawText | null } | null;
  contents?: readonly unknown[] | null;
  endpoint?: RawEndpoint | null;
}

/** Playlists are opened by their bare id; browse ids for them carry a `VL` prefix. */
export function playlistIdFromBrowseId(id: string): string {
  return id.startsWith("VL") ? id.slice(2) : id;
}

export async function getAlbum(youtube: Innertube, id: string): Promise<AlbumPage> {
  const raw = (await youtube.music.getAlbum(id)) as unknown as {
    header?: RawHeader | null;
    contents?: readonly unknown[] | null;
  };
  return albumFrom(id, raw);
}

/**
 * Album rows carry only the title, duration and id: YouTube leaves the album,
 * artists and artwork to the header, so they are filled in from there. Without
 * that, queueing a track off an album page would put a coverless, artistless
 * row into the now-playing bar.
 */
export function albumFrom(
  id: string,
  raw: { header?: RawHeader | null; contents?: readonly unknown[] | null },
): AlbumPage {
  const header = raw.header ?? {};
  const title = text(header.title) ?? "";
  const artists = artistsFromRuns(header.strapline_text_one);
  const thumbnails = headerThumbnails(header);
  const tracks: Track[] = [];
  for (const row of raw.contents ?? []) {
    const track = toTrack(row as RawSong);
    if (track === null) continue;
    tracks.push({
      ...track,
      artists: track.artists.length > 0 ? track.artists : artists,
      album: track.album ?? title,
      albumId: track.albumId ?? id,
      thumbnails: track.thumbnails.length > 0 ? track.thumbnails : thumbnails,
    });
  }
  return AlbumPage.parse({
    id,
    title,
    subtitle: joinSubtitles(header),
    artists,
    thumbnails,
    tracks,
  });
}

export async function getPlaylist(youtube: Innertube, id: string): Promise<PlaylistPage> {
  const playlistId = playlistIdFromBrowseId(id);
  type RawPlaylist = {
    header?: RawHeader | null;
    items?: readonly unknown[] | null;
    has_continuation?: boolean;
    getContinuation(): Promise<RawPlaylist>;
  };
  let page = (await youtube.music.getPlaylist(playlistId)) as unknown as RawPlaylist;
  const header = page.header ?? {};
  const rows = [...(page.items ?? [])];
  // Long playlists — a liked-songs list, say — arrive a hundred rows at a
  // time. Bounded, so a runaway continuation cannot hold the page forever.
  for (let pages = 1; page.has_continuation && pages < MAX_PLAYLIST_PAGES; pages++) {
    page = await page.getContinuation();
    rows.push(...(page.items ?? []));
  }
  return playlistFrom(playlistId, header, rows);
}

const MAX_PLAYLIST_PAGES = 20;

export function playlistFrom(
  id: string,
  header: RawHeader,
  rows: readonly unknown[],
): PlaylistPage {
  const tracks: Track[] = [];
  for (const row of rows) {
    const track = toTrack(row as RawSong);
    if (track !== null) tracks.push(track);
  }
  return PlaylistPage.parse({
    id,
    title: text(header.title) ?? "",
    subtitle: joinSubtitles(header),
    thumbnails: headerThumbnails(header),
    tracks,
  });
}

export async function getArtist(youtube: Innertube, id: string): Promise<ArtistPage> {
  const raw = (await youtube.music.getArtist(id)) as unknown as {
    header?: RawHeader | null;
    sections?: readonly RawSection[] | null;
  };
  return artistFrom(id, raw);
}

export function artistFrom(
  id: string,
  raw: { header?: RawHeader | null; sections?: readonly RawSection[] | null },
): ArtistPage {
  const header = raw.header ?? {};
  let topSongs: Track[] = [];
  let topSongsPlaylistId: string | null = null;
  const shelves: ArtistPage["shelves"] = [];

  for (const section of raw.sections ?? []) {
    const title = text(section.title) ?? text(section.header?.title) ?? "";
    if (section.type === "MusicShelf" && topSongs.length === 0) {
      topSongs = (section.contents ?? [])
        .map((row) => toTrack(row as RawSong))
        .filter((track): track is Track => track !== null);
      const more = browseId(section.endpoint);
      topSongsPlaylistId = more ? playlistIdFromBrowseId(more) : null;
      continue;
    }
    if (section.type !== "MusicCarouselShelf") continue;
    const cards = (section.contents ?? [])
      .map((card) => toCard(card as RawCard))
      .filter((card): card is BrowseCard => card !== null);
    // A shelf of videos has no card kind we can open; it drops out here.
    if (cards.length > 0) shelves.push({ title, cards });
  }

  return ArtistPage.parse({
    id,
    name: text(header.title) ?? "",
    description: text(header.description),
    thumbnails: headerThumbnails(header),
    topSongs,
    topSongsPlaylistId,
    shelves,
  });
}

const CARD_KINDS: Record<string, BrowseCard["kind"]> = {
  album: "album",
  playlist: "playlist",
  artist: "artist",
};

export function toCard(raw: RawCard): BrowseCard | null {
  const kind = typeof raw.item_type === "string" ? CARD_KINDS[raw.item_type] : undefined;
  const id = browseId(raw.endpoint) ?? (typeof raw.id === "string" ? raw.id : null);
  const title = typeof raw.title === "string" ? raw.title : text(raw.title);
  if (!kind || !id || !title) return null;
  const card = BrowseCard.safeParse({
    kind,
    id: kind === "playlist" ? playlistIdFromBrowseId(id) : id,
    title,
    subtitle: text(raw.subtitle),
    thumbnails: toThumbnails(raw.thumbnail ?? undefined),
  });
  return card.success ? card.data : null;
}

function text(raw: RawText | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const value = raw.toString().trim();
  // youtubei.js renders an absent `Text` as the literal "N/A".
  return value.length > 0 && value !== "N/A" ? value : null;
}

function joinSubtitles(header: RawHeader): string | null {
  const parts = [text(header.subtitle), text(header.second_subtitle)].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(" • ") : null;
}

function browseId(endpoint: RawEndpoint | null | undefined): string | null {
  const id = endpoint?.payload?.browseId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** An album's byline: each run that links to a channel is an artist. */
function artistsFromRuns(raw: RawText | null | undefined): Artist[] {
  const runs = raw?.runs ?? [];
  const linked = runs
    .map((run) => ({ name: run.text, channel_id: browseId(run.endpoint) }))
    .filter((run) => run.channel_id?.startsWith("UC"));
  if (linked.length > 0) return toArtists(linked);
  const name = text(raw);
  return name ? [{ name, channelId: null }] : [];
}

function headerThumbnails(header: RawHeader): Thumbnail[] {
  return toThumbnails(header.thumbnail?.contents ?? header.thumbnails ?? undefined);
}
