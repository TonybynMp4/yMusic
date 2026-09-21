import {
  AlbumPage,
  ArtistPage,
  type Artist,
  BrowseCard,
  PlaylistPage,
  type Thumbnail,
  type Track,
} from "@ytbm/core";
import { YTNodes, type Innertube } from "youtubei.js";

import { toArtists, toTrack, type RawSong } from "./parse.ts";
import { squareCrop, toThumbnails, type RawThumbnail } from "./thumbnails.ts";

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
  /** The round picture on a `MusicVisualHeader`, when YouTube sends one. */
  foreground_thumbnail?: { contents?: readonly RawThumbnail[] | null } | null;
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

/** The rest of a long playlist, a page of rows at a time. */
export type PlaylistMore = () => Promise<{ tracks: Track[]; more: PlaylistMore | null }>;

/**
 * The header and the first page of rows, with a way to fetch the rest.
 *
 * Long playlists (a liked-songs list, say) arrive a hundred rows at a time,
 * and each page is a round trip, so fetching them all before showing anything
 * leaves a large library blank for half a minute.
 */
export async function openPlaylist(
  youtube: Innertube,
  id: string,
): Promise<{ page: PlaylistPage; more: PlaylistMore | null }> {
  const playlistId = playlistIdFromBrowseId(id);
  const first = (await youtube.music.getPlaylist(playlistId)) as unknown as RawPlaylist;
  return {
    page: playlistFrom(playlistId, first.header ?? {}, first.items ?? []),
    more: continuing(first, 1),
  };
}

type RawPlaylist = {
  header?: RawHeader | null;
  items?: readonly unknown[] | null;
  has_continuation?: boolean;
  getContinuation(): Promise<RawPlaylist>;
};

/** Bounded, so a runaway continuation cannot keep fetching forever. */
function continuing(page: RawPlaylist, pages: number): PlaylistMore | null {
  if (!page.has_continuation || pages >= MAX_PLAYLIST_PAGES) return null;
  return async () => {
    const next = await page.getContinuation();
    return { tracks: tracksFrom(next.items ?? []), more: continuing(next, pages + 1) };
  };
}

/** The whole playlist in one go, for callers that need every row. */
export async function getPlaylist(youtube: Innertube, id: string): Promise<PlaylistPage> {
  const { page, more } = await openPlaylist(youtube, id);
  const tracks = [...page.tracks];
  for (let next = more; next; ) {
    const chunk = await next();
    tracks.push(...chunk.tracks);
    next = chunk.more;
  }
  return { ...page, tracks };
}

const MAX_PLAYLIST_PAGES = 100;

function tracksFrom(rows: readonly unknown[]): Track[] {
  const tracks: Track[] = [];
  for (const row of rows) {
    const track = toTrack(row as RawSong);
    if (track !== null) tracks.push(track);
  }
  return tracks;
}

export function playlistFrom(
  id: string,
  header: RawHeader,
  rows: readonly unknown[],
): PlaylistPage {
  return PlaylistPage.parse({
    id,
    title: text(header.title) ?? "",
    subtitle: joinSubtitles(header),
    thumbnails: headerThumbnails(header),
    tracks: tracksFrom(rows),
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

  const thumbnails = headerThumbnails(header);
  const foreground = toThumbnails(header.foreground_thumbnail?.contents ?? undefined);
  return ArtistPage.parse({
    id,
    name: text(header.title) ?? "",
    description: text(header.description),
    thumbnails,
    avatar: foreground.length > 0 ? foreground : squareCrop(thumbnails),
    topSongs,
    topSongsPlaylistId,
    shelves,
  });
}

/**
 * The signed-in account's playlists, as YouTube Music's library lists them:
 * Liked Music (`LM`) first, then saved and created playlists. Read straight
 * from the browse page rather than through `music.getLibrary`, whose landing
 * page shows whatever tab YouTube last defaulted to.
 */
export async function getLibraryPlaylists(youtube: Innertube): Promise<BrowseCard[]> {
  type RawGrid = { items?: readonly unknown[] | null; continuation?: string | null };
  const first = await youtube.actions.execute("/browse", {
    browseId: LIBRARY_PLAYLISTS,
    client: "YTMUSIC",
    parse: true,
  });
  const grid = first.contents_memo?.getType(YTNodes.Grid)[0] as RawGrid | undefined;
  const items = [...(grid?.items ?? [])];
  let token = grid?.continuation ?? null;
  for (let pages = 1; token && pages < MAX_LIBRARY_PAGES; pages++) {
    const next = await youtube.actions.execute("/browse", {
      continuation: token,
      client: "YTMUSIC",
      parse: true,
    });
    const more = next.continuation_contents as RawGrid | undefined;
    items.push(...(more?.items ?? []));
    token = more?.continuation ?? null;
  }
  return libraryFrom(items);
}

const LIBRARY_PLAYLISTS = "FEmusic_liked_playlists";
const MAX_LIBRARY_PAGES = 10;

/** The "New playlist" tile has no browse id, so it drops out with anything else unopenable. */
export function libraryFrom(items: readonly unknown[]): BrowseCard[] {
  return items
    .map((item) => toCard(item as RawCard))
    .filter((card): card is BrowseCard => card?.kind === "playlist");
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
