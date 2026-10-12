import { YTMusic, type Innertube } from "youtubei.js";
import {
  BrowseCard,
  SearchFilter,
  type SearchResults,
  type SearchShelf,
  type Track,
} from "@ymusic/core";

import { artistsFromRuns, playlistIdFromBrowseId, type RawText } from "./browse.ts";
import { toTrack, type RawSong } from "./parse.ts";
import { toThumbnails, type RawThumbnail } from "./thumbnails.ts";

/**
 * Each filter's search `params`, as YouTube Music's chips send them, and the
 * start of the chip's own params, which says the chip was offered. The chips
 * add a suffix that varies by query, so only the start is matched. Featured
 * playlists have no value in youtubei.js's filter enum, so these are spelled
 * out rather than encoded through it.
 */
const FILTERS: Record<SearchFilter, { params: string; chip: string }> = {
  songs: { params: "EgWKAQIIAQ%3D%3D", chip: "EgWKAQIIA" },
  videos: { params: "EgWKAQIQAQ%3D%3D", chip: "EgWKAQIQA" },
  albums: { params: "EgWKAQIYAQ%3D%3D", chip: "EgWKAQIYA" },
  "featured-playlists": { params: "EgeKAQQoADgB", chip: "EgeKAQQoADgB" },
  "community-playlists": { params: "EgeKAQQoAEAB", chip: "EgeKAQQoAEAB" },
  artists: { params: "EgWKAQIgAQ%3D%3D", chip: "EgWKAQIgA" },
};

/** The next page of a chip's results. */
export type SearchMore = () => Promise<{ results: SearchResults; more: SearchMore | null }>;

/**
 * Pages a chip loads at most, twenty rows each. YouTube Music keeps offering
 * more well past where the results stop matching, so this bounds a long scroll.
 */
const MAX_SEARCH_PAGES = 10;

/**
 * A YouTube Music search: everything when `filter` is null, one kind otherwise.
 * A filtered search returns its first 20 rows, and `more` fetches the next.
 *
 * YouTube Music rather than plain YouTube: the two post to the same
 * `/youtubei/v1/search` endpoint and differ only by the client context in the
 * body (`WEB_REMIX` against `WEB`). Plain search returns videos, with no album
 * and no artist channel, so the wrong one here is not a build error or even an
 * obviously wrong result, just a quietly worse music app. `live.test.ts`
 * asserts the client that actually goes on the wire.
 */
export async function searchMusic(
  youtube: Innertube,
  query: string,
  filter: SearchFilter | null = null,
): Promise<{ results: SearchResults; more: SearchMore | null }> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { results: { top: null, shelves: [], filters: [] }, more: null };
  const response = await youtube.actions.execute("/search", {
    query: trimmed,
    ...(filter ? { params: FILTERS[filter].params } : {}),
    client: "YTMUSIC",
  });
  const search = new YTMusic.Search(response, youtube.actions, filter !== null);
  return {
    results: resultsFrom(search),
    more: search.has_continuation ? searchMore(search, 1) : null,
  };
}

/** Songs matching a query: the songs filter, for callers that want tracks alone. */
export async function searchSongs(youtube: Innertube, query: string): Promise<Track[]> {
  const { results } = await searchMusic(youtube, query, "songs");
  return results.shelves.flatMap((shelf) => (shelf.kind === "tracks" ? shelf.tracks : []));
}

/** youtubei.js's `SearchContinuation`: one more page of the chip's shelf. */
interface RawContinuation {
  contents?: { type?: unknown; contents?: readonly unknown[] | null; continuation?: unknown } | null;
  getContinuation(): Promise<RawContinuation>;
}

/** Exported for tests. `pages` counts the pages already loaded, the first included. */
export function searchMore(
  page: { getContinuation(): Promise<RawContinuation> },
  pages: number,
): SearchMore {
  return async () => {
    const next = await page.getContinuation();
    const shelf = next.contents;
    return {
      results: resultsFrom({ contents: shelf ? [shelf] : [] }),
      more: shelf?.continuation && pages + 1 < MAX_SEARCH_PAGES ? searchMore(next, pages + 1) : null,
    };
  };
}

interface RawRun {
  text?: unknown;
  endpoint?: { payload?: RawPayload | null } | null;
}

interface RawPayload {
  browseId?: unknown;
  videoId?: unknown;
  browseEndpointContextSupportedConfigs?: {
    browseEndpointContextMusicConfig?: { pageType?: unknown } | null;
  } | null;
}

/** youtubei.js's `MusicResponsiveListItem`, read structurally. */
interface RawRow extends Omit<RawSong, "flex_columns"> {
  type?: unknown;
  name?: unknown;
  subtitle?: RawText | null;
  author?: { name?: unknown; channel_id?: unknown } | null;
  endpoint?: { payload?: RawPayload | null } | null;
  flex_columns?: readonly { title?: (RawText & { runs?: readonly RawRun[] | null }) | null }[] | null;
}

interface RawCardShelf {
  type?: unknown;
  title?: RawText | null;
  subtitle?: RawText | null;
  on_tap?: { payload?: RawPayload | null } | null;
  thumbnail?: { contents?: readonly RawThumbnail[] | null } | null;
  contents?: readonly unknown[] | null;
}

interface RawSearch {
  header?: { chips?: readonly { endpoint?: { payload?: { params?: unknown } } | null }[] } | null;
  contents?: readonly { type?: unknown; contents?: readonly unknown[] | null }[] | null;
}

/**
 * The results out of a parsed music search.
 *
 * Exported for tests, and split from the request so it runs against recorded
 * responses. An unfiltered search is not a set of shelves: it is a notice, the
 * top result card, then one `ItemSection` per row, every kind mixed in
 * YouTube's ranking. A filtered one is a notice and one `MusicShelf`. Both are
 * read the same way, row by row, sorting each into its kind; a kind's shelf
 * sits where its best row ranked.
 */
export function resultsFrom(search: RawSearch): SearchResults {
  let top: SearchResults["top"] = null;
  const shelves: SearchShelf[] = [];
  const shelfFor = (filter: SearchFilter): SearchShelf => {
    let shelf = shelves.find((s) => s.filter === filter);
    if (!shelf) {
      shelf =
        filter === "songs" || filter === "videos"
          ? { kind: "tracks", filter, tracks: [] }
          : { kind: "cards", filter, cards: [] };
      shelves.push(shelf);
    }
    return shelf;
  };

  for (const section of search.contents ?? []) {
    if (section?.type === "MusicCardShelf") {
      top ??= topFrom(section as RawCardShelf);
      continue;
    }
    for (const row of section?.contents ?? []) {
      const result = rowFrom(row as RawRow);
      if (result === null) continue;
      const shelf = shelfFor(result.filter);
      if (shelf.kind === "tracks" && "track" in result) shelf.tracks.push(result.track);
      if (shelf.kind === "cards" && "card" in result) shelf.cards.push(result.card);
    }
  }

  const offered = (search.header?.chips ?? []).map((chip) => chip?.endpoint?.payload?.params);
  // The enum is in YouTube Music's chip order, which is the order they show here.
  const filters = SearchFilter.options.filter((filter) =>
    offered.some((params) => typeof params === "string" && params.startsWith(FILTERS[filter].chip)),
  );
  return { top, shelves, filters };
}

type Row =
  | { filter: "songs" | "videos"; track: Track }
  | { filter: Exclude<SearchFilter, "songs" | "videos">; card: BrowseCard };

/**
 * One row by its kind, or null for what the app has no page for: profiles
 * (user channels), podcasts and their episodes.
 */
function rowFrom(row: RawRow): Row | null {
  if (row?.type !== "MusicResponsiveListItem") return null;
  switch (row.item_type) {
    case "song": {
      const track = toTrack(songOf(row, row.artists ?? row.authors));
      return track && { filter: "songs", track };
    }
    case "video": {
      const track = toTrack(songOf(row, row.authors ?? row.artists));
      return track && { filter: "videos", track };
    }
    case "unknown": {
      const track = unknownVideo(row);
      return track && { filter: "videos", track };
    }
    case "album": {
      const card = cardFrom(row, "album");
      return card && { filter: "albums", card };
    }
    case "playlist": {
      const card = cardFrom(row, "playlist");
      if (!card) return null;
      return { filter: isFeatured(card.id) ? "featured-playlists" : "community-playlists", card };
    }
    case "artist": {
      if (pageType(row.endpoint?.payload) !== "MUSIC_PAGE_TYPE_ARTIST") return null;
      const card = cardFrom(row, "artist");
      return card && { filter: "artists", card };
    }
    default:
      return null;
  }
}

/**
 * The fields `toTrack` reads, copied by name: `thumbnails` is a getter on the
 * row's class, which a spread would silently leave behind. Videos name their
 * uploader in `authors` where songs have `artists`.
 */
function songOf(row: RawRow, artists: RawSong["artists"] | undefined): RawSong {
  return {
    id: row.id,
    item_type: row.item_type,
    title: row.title,
    duration: row.duration ?? null,
    album: row.album ?? null,
    artists: artists ?? null,
    thumbnails: row.thumbnails ?? null,
    badges: row.badges ?? null,
    year: row.year,
    flex_columns: (row.flex_columns ?? null) as NonNullable<RawSong["flex_columns"]> | null,
  };
}

/** YouTube Music's own playlists, which it lists apart as "Featured playlists". */
function isFeatured(playlistId: string): boolean {
  return playlistId.startsWith("RDCLAK");
}

/**
 * A video youtubei.js does not recognise: an official upload that is neither
 * a song nor a music video (`MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC`, such as
 * a trailer). Its id is only on the title's play link.
 */
function unknownVideo(row: RawRow): Track | null {
  const [title, byline] = row.flex_columns ?? [];
  const run = title?.title?.runs?.[0];
  const videoId = run?.endpoint?.payload?.videoId;
  if (typeof videoId !== "string") return null;
  return toTrack({
    id: videoId,
    title: run?.text,
    thumbnails: row.thumbnails ?? null,
    artists: rawArtists(byline?.title),
  });
}

/** A byline's artists, in the raw shape `toTrack` reads. */
function rawArtists(byline: RawText | null | undefined): NonNullable<RawSong["artists"]> {
  return artistsFromRuns(byline).map(({ name, channelId }) => ({ name, channel_id: channelId }));
}

function cardFrom(row: RawRow, kind: BrowseCard["kind"]): BrowseCard | null {
  const id = row.endpoint?.payload?.browseId ?? row.id;
  const title = typeof row.title === "string" ? row.title : row.name;
  if (typeof id !== "string" || typeof title !== "string" || id.length === 0) return null;
  const card = BrowseCard.safeParse({
    kind,
    id: kind === "playlist" ? playlistIdFromBrowseId(id) : id,
    title,
    subtitle: subtitleOf(row),
    thumbnails: toThumbnails(row.thumbnails ?? undefined),
  });
  return card.success ? card.data : null;
}

/**
 * The row's second line, as YouTube wrote it ("Album • Boards of Canada •
 * 1998"), less a leading "Playlist" or "Artist": the shelf already says so.
 * "Album", "Single" and "EP" stay, since they tell albums apart.
 */
function subtitleOf(row: RawRow): string | null {
  const line = row.subtitle ?? row.flex_columns?.[1]?.title;
  const value = line?.toString().trim();
  if (!value || value === "N/A") return null;
  const stripped = value.replace(/^(Playlist|Artist|Song|Video) • /, "");
  return stripped.length > 0 ? stripped : null;
}

/** The top result card: what it opens or plays, and the songs it lists. */
function topFrom(shelf: RawCardShelf): SearchResults["top"] {
  const tracks: Track[] = [];
  for (const row of shelf.contents ?? []) {
    const result = rowFrom(row as RawRow);
    if (result && "track" in result) tracks.push(result.track);
  }
  const payload = shelf.on_tap?.payload;
  const title = shelf.title?.toString().trim();
  if (!title) return null;
  const thumbnails = toThumbnails(shelf.thumbnail?.contents ?? undefined);

  if (typeof payload?.videoId === "string") {
    const track = toTrack({
      id: payload.videoId,
      title,
      thumbnails: shelf.thumbnail?.contents ?? null,
      artists: rawArtists(shelf.subtitle),
    });
    return track && { item: { kind: "track", track }, tracks };
  }

  const kind = CARD_PAGES[String(pageType(payload))];
  const id = payload?.browseId;
  if (!kind || typeof id !== "string") return null;
  const card = BrowseCard.safeParse({
    kind,
    id: kind === "playlist" ? playlistIdFromBrowseId(id) : id,
    title,
    subtitle: shelf.subtitle?.toString().trim() || null,
    thumbnails,
  });
  return card.success ? { item: { kind: "card", card: card.data }, tracks } : null;
}

const CARD_PAGES: Record<string, BrowseCard["kind"]> = {
  MUSIC_PAGE_TYPE_ALBUM: "album",
  MUSIC_PAGE_TYPE_PLAYLIST: "playlist",
  MUSIC_PAGE_TYPE_ARTIST: "artist",
};

function pageType(payload: RawPayload | null | undefined): unknown {
  return payload?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
}
