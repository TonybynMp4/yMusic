import {
  AlbumPage,
  ArtistPage,
  type Artist,
  BrowseCard,
  PlaylistPage,
  type Thumbnail,
  type Track,
} from "@ymusic/core";
import { YTNodes, type Innertube } from "youtubei.js";

import { toArtists, toTrack, yearFrom, type RawSong } from "./parse.ts";
import { squareCrop, toThumbnails, type RawThumbnail } from "./thumbnails.ts";

/**
 * Album, artist and playlist pages from YouTube Music.
 *
 * Same stance as `parse.ts`: youtubei.js's objects are read structurally,
 * through the few fields used here, and a row that does not fit is dropped
 * rather than failing the page.
 */

/** Anything youtubei.js renders as text: a `Text` with runs, or a plain string. */
export interface RawText {
  toString(): string;
  runs?: readonly { text?: unknown; endpoint?: RawEndpoint | null }[] | null;
}

export interface RawEndpoint {
  payload?: { browseId?: unknown; playlistId?: unknown; videoId?: unknown } | null;
}

/** A header button: the library toggle, the play button, "Shuffle", "Mix". */
interface RawButton {
  type?: unknown;
  is_toggled?: unknown;
  endpoint?: RawEndpoint | null;
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
  buttons?: readonly RawButton[] | null;
  /** An artist's. */
  subscription_button?: { subscribed?: unknown } | null;
  start_radio_button?: RawButton | null;
}

interface RawCard {
  id?: unknown;
  item_type?: unknown;
  title?: RawText | string | null;
  /** A list row's artist has a name rather than a title. */
  name?: string | null;
  subtitle?: RawText | null;
  /** An array on a card, a `MusicThumbnail` on a list row. */
  thumbnail?: readonly RawThumbnail[] | { contents?: readonly RawThumbnail[] | null } | null;
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
  const year = yearFrom(text(header.subtitle));
  const tracks: Track[] = [];
  for (const row of raw.contents ?? []) {
    const track = toTrack(row as RawSong);
    if (track === null) continue;
    tracks.push({
      ...track,
      year: track.year ?? year,
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
    audioPlaylistId: playlistOf(button(header, "MusicPlayButton")),
    saved: savedIn(header),
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
    saved: savedIn(header),
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
    mix: mixOf(header.start_radio_button),
    subscribed:
      typeof header.subscription_button?.subscribed === "boolean"
        ? header.subscription_button.subscribed
        : null,
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
  return libraryFrom((await libraryItems(youtube, LIBRARY_PLAYLISTS)).items);
}

/** The library lists that YouTube Music sorts on the server. */
export type LibraryKind = "playlists" | "albums" | "artists";

/**
 * A library list in the order asked for. `sorts` are the orders YouTube
 * offers for it, in its own words and language; `sort` is the one applied.
 */
export interface LibraryCards {
  cards: BrowseCard[];
  sorts: string[];
  sort: string | null;
}

/**
 * The account's playlists, saved albums, or the artists of the songs in the
 * library, as YouTube Music's chips list them. Artist rows open a
 * library-only page (`MPLAUC…`), so their cards open the artist's own page
 * instead.
 */
export async function getLibraryCards(
  youtube: Innertube,
  kind: LibraryKind,
  sort?: string,
): Promise<LibraryCards> {
  const page = LIBRARY_PAGES[kind];
  const { items, sorts, sort: applied } = await libraryItems(youtube, page, sort);
  const cards =
    kind === "playlists"
      ? libraryFrom(items)
      : cardsOf(items, kind === "albums" ? "album" : "artist");
  return { cards, sorts, sort: applied };
}

/**
 * Every row of a library list, a page at a time: a grid of cards (playlists,
 * albums) or a shelf of rows (artists). Bounded, so a runaway continuation
 * cannot keep fetching forever.
 */
async function libraryItems(
  youtube: Innertube,
  page: string,
  sort?: string,
): Promise<{ items: unknown[]; sorts: string[]; sort: string | null }> {
  const first = await libraryFirst(youtube, page, sort);
  const items = [...rowsOf(first.list)];
  let token = first.list?.continuation ?? null;
  for (let pages = 1; token && pages < MAX_LIBRARY_PAGES; pages++) {
    const next = await youtube.actions.execute("/browse", {
      continuation: token,
      client: "YTMUSIC",
      parse: true,
    });
    const more = next.continuation_contents as RawList | undefined;
    items.push(...rowsOf(more));
    token = more?.continuation ?? null;
  }
  return { items, sorts: first.sorts, sort: first.sort };
}

/**
 * The first page of a library list, and the sorts its menu offers. A sort
 * other than the one YouTube applied reloads the list through that option's
 * own continuation, as YouTube Music's sort menu does.
 */
async function libraryFirst(
  youtube: Innertube,
  page: string,
  sort?: string,
): Promise<{ list: RawList | undefined; sorts: string[]; sort: string | null }> {
  const first = await youtube.actions.execute("/browse", {
    browseId: page,
    client: "YTMUSIC",
    parse: true,
  });
  const menu = sortMenu(first.contents_memo?.getType(YTNodes.MusicSortFilterButton)[0]);
  const list = listIn(first.contents_memo?.getType(YTNodes.Grid, YTNodes.MusicShelf));
  const option = menu.options.find((o) => o.title === sort);
  if (!option?.reload || option.title === menu.applied) {
    return { list, sorts: menu.sorts, sort: menu.applied };
  }
  const sorted = await youtube.actions.execute("/browse", {
    continuation: option.reload,
    client: "YTMUSIC",
    parse: true,
  });
  const section = sorted.continuation_contents as { contents?: unknown } | undefined;
  return {
    list: listIn(section?.contents as readonly unknown[] | undefined),
    sorts: menu.sorts,
    sort: option.title,
  };
}

/** The first grid or shelf among `nodes`. */
function listIn(nodes: readonly unknown[] | null | undefined): RawList | undefined {
  return nodes?.find((n) => n instanceof YTNodes.Grid || n instanceof YTNodes.MusicShelf) as
    | RawList
    | undefined;
}

/**
 * The options of a library list's sort menu. The button reads as the sort in
 * use; each option reloads the list through a continuation of its own.
 */
export function sortMenu(node: unknown): {
  sorts: string[];
  applied: string | null;
  options: { title: string; reload: string | null }[];
} {
  const raw = node as
    | { title?: string; menu?: { options?: readonly unknown[] } | null }
    | undefined;
  const options = (raw?.menu?.options ?? []).flatMap((item) => {
    const option = item as {
      title?: string;
      endpoint?: { payload?: { commands?: readonly SortCommand[] } };
    };
    if (typeof option.title !== "string" || option.title === "") return [];
    const reload = option.endpoint?.payload?.commands?.find(
      (c) => c.browseSectionListReloadEndpoint,
    )?.browseSectionListReloadEndpoint?.continuation?.reloadContinuationData?.continuation;
    return [{ title: option.title, reload: reload ?? null }];
  });
  const sorts = options.map((o) => o.title);
  const applied = sorts.includes(raw?.title ?? "") ? raw!.title! : null;
  return { sorts, applied, options };
}

type SortCommand = {
  browseSectionListReloadEndpoint?: {
    continuation?: { reloadContinuationData?: { continuation?: string } };
  };
};

/** A grid or its continuation has `items`; a shelf or its continuation, `contents`. */
type RawList = {
  items?: readonly unknown[] | null;
  contents?: readonly unknown[] | null;
  continuation?: string | null;
};

function rowsOf(list: RawList | undefined): readonly unknown[] {
  return list?.items ?? list?.contents ?? [];
}

/**
 * The songs saved to the library in the order asked for: the first page of
 * rows, with a way to fetch the rest, as a long playlist arrives.
 */
export async function openLibrarySongs(
  youtube: Innertube,
  sort?: string,
): Promise<{ tracks: Track[]; more: PlaylistMore | null; sorts: string[]; sort: string | null }> {
  const first = await libraryFirst(youtube, LIBRARY_SONGS, sort);
  return {
    tracks: tracksFrom(rowsOf(first.list)),
    more: songsAfter(youtube, first.list?.continuation, 1),
    sorts: first.sorts,
    sort: first.sort,
  };
}

function songsAfter(
  youtube: Innertube,
  token: string | null | undefined,
  pages: number,
): PlaylistMore | null {
  if (!token || pages >= MAX_PLAYLIST_PAGES) return null;
  return async () => {
    const next = await youtube.actions.execute("/browse", {
      continuation: token,
      client: "YTMUSIC",
      parse: true,
    });
    const more = next.continuation_contents as RawList | undefined;
    return {
      tracks: tracksFrom(rowsOf(more)),
      more: songsAfter(youtube, more?.continuation, pages + 1),
    };
  };
}

const LIBRARY_PLAYLISTS = "FEmusic_liked_playlists";
const LIBRARY_PAGES: Record<LibraryKind, string> = {
  playlists: LIBRARY_PLAYLISTS,
  albums: "FEmusic_liked_albums",
  artists: "FEmusic_library_corpus_track_artists",
};
const LIBRARY_SONGS = "FEmusic_liked_videos";
const MAX_LIBRARY_PAGES = 20;

/** The "New playlist" tile has no browse id, so it drops out with anything else unopenable. */
export function libraryFrom(items: readonly unknown[]): BrowseCard[] {
  return cardsOf(items, "playlist");
}

/** The rows of a library list that open as `kind`; anything else drops out. */
export function cardsOf(items: readonly unknown[], kind: BrowseCard["kind"]): BrowseCard[] {
  return items
    .map((item) => toCard(item as RawCard))
    .filter((card): card is BrowseCard => card?.kind === kind);
}

/** One of your playlists, as "Save to playlist" lists them. */
export interface PlaylistTarget {
  id: string;
  title: string;
}

/**
 * The playlists `videoId` can be added to: the ones you own, newest edited
 * first, as YouTube Music's own "Save to playlist" dialog lists them.
 */
export async function getPlaylistTargets(
  youtube: Innertube,
  videoId: string,
): Promise<PlaylistTarget[]> {
  const response = await youtube.actions.execute("/playlist/get_add_to_playlist", {
    videoIds: [videoId],
    excludeWatchLater: true,
    client: "YTMUSIC",
    parse: true,
  });
  const options = response.contents_memo?.getType(YTNodes.PlaylistAddToOption) ?? [];
  return targetsFrom(options as unknown as readonly RawTarget[]);
}

/** What YouTube Music's "New playlist" dialog asks for. */
export interface NewPlaylist {
  title: string;
  description: string;
  privacy: "PUBLIC" | "UNLISTED" | "PRIVATE";
}

export async function createPlaylist(
  youtube: Innertube,
  playlist: NewPlaylist,
  videoIds: readonly string[],
): Promise<string> {
  const response = await youtube.actions.execute("/playlist/create", {
    title: playlist.title,
    description: playlist.description,
    privacyStatus: playlist.privacy,
    videoIds: [...videoIds],
    client: "YTMUSIC",
  });
  const id = (response.data as { playlistId?: unknown } | undefined)?.playlistId;
  if (typeof id !== "string") throw new Error("YouTube did not create the playlist");
  return id;
}

interface RawTarget {
  playlist_id?: unknown;
  title?: RawText | null;
}

export function targetsFrom(options: readonly RawTarget[]): PlaylistTarget[] {
  const targets: PlaylistTarget[] = [];
  for (const option of options) {
    const title = text(option.title);
    if (typeof option.playlist_id !== "string" || !title) continue;
    targets.push({ id: option.playlist_id, title });
  }
  return targets;
}

const CARD_KINDS: Record<string, BrowseCard["kind"]> = {
  album: "album",
  playlist: "playlist",
  artist: "artist",
  library_artist: "artist",
};

/** A library artist's browse id is the channel id behind this prefix. */
const LIBRARY_ARTIST_PREFIX = "MPLA";

export function toCard(raw: RawCard): BrowseCard | null {
  const kind = typeof raw.item_type === "string" ? CARD_KINDS[raw.item_type] : undefined;
  const id = browseId(raw.endpoint) ?? (typeof raw.id === "string" ? raw.id : null);
  const title =
    typeof raw.title === "string" ? raw.title : (text(raw.title) ?? text(raw.name ?? null));
  if (!kind || !id || !title) return null;
  const card = BrowseCard.safeParse({
    kind,
    id: cardId(kind, id),
    title,
    subtitle: text(raw.subtitle),
    thumbnails: toThumbnails(cardThumbnails(raw.thumbnail)),
  });
  return card.success ? card.data : null;
}

function cardThumbnails(raw: RawCard["thumbnail"]): readonly RawThumbnail[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  if ("contents" in raw) return raw.contents ?? undefined;
  return raw as readonly RawThumbnail[];
}

function cardId(kind: BrowseCard["kind"], id: string): string {
  if (kind === "playlist") return playlistIdFromBrowseId(id);
  if (kind === "artist" && id.startsWith(`${LIBRARY_ARTIST_PREFIX}UC`)) {
    return id.slice(LIBRARY_ARTIST_PREFIX.length);
  }
  return id;
}

function text(raw: RawText | string | null | undefined): string | null {
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
export function artistsFromRuns(raw: RawText | null | undefined): Artist[] {
  const runs = raw?.runs ?? [];
  const linked = runs
    .map((run) => ({ name: run.text, channel_id: browseId(run.endpoint) }))
    .filter((run) => run.channel_id?.startsWith("UC"));
  if (linked.length > 0) return toArtists(linked);
  const name = text(raw);
  return name ? [{ name, channelId: null }] : [];
}

function button(header: RawHeader, type: string): RawButton | null {
  return header.buttons?.find((b) => b.type === type) ?? null;
}

/** The library toggle, a bookmark on albums and playlists. Your own playlists have none. */
function savedIn(header: RawHeader): boolean | null {
  const toggle = button(header, "ToggleButton");
  return typeof toggle?.is_toggled === "boolean" ? toggle.is_toggled : null;
}

function playlistOf(raw: RawButton | null | undefined): string | null {
  const id = raw?.endpoint?.payload?.playlistId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function mixOf(raw: RawButton | null | undefined): ArtistPage["mix"] {
  const playlistId = playlistOf(raw);
  if (playlistId === null) return null;
  const videoId = raw?.endpoint?.payload?.videoId;
  return { playlistId, videoId: typeof videoId === "string" ? videoId : null };
}

function headerThumbnails(header: RawHeader): Thumbnail[] {
  return toThumbnails(header.thumbnail?.contents ?? header.thumbnails ?? undefined);
}
