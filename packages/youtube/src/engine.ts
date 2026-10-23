import type {
  AlbumPage,
  AudioQuality,
  ArtistPage,
  BrowseCard,
  PlaylistPage,
  SearchFilter,
  SearchResults,
  StreamLease,
  Thumbnail,
  Track,
  VideoId,
} from "@ymusic/core";
import { ClientType, Constants, type Innertube } from "youtubei.js";

import {
  createFallbackPlayer,
  createPlayer,
  createSignedInPlayer,
  createVisitor,
  createYouTube,
  type FetchLike,
} from "./client.ts";
import {
  createPlaylist,
  getAlbum,
  getArtist,
  getLibraryCards,
  getLibraryPlaylists,
  getPlaylistTargets,
  openLibrarySongs,
  openPlaylist,
  playlistIdFromBrowseId,
  type LibraryCards,
  type LibraryKind,
  type NewPlaylist,
  type PlaylistMore,
  type PlaylistTarget,
} from "./browse.ts";
import {
  coverAction,
  coverOf,
  deletePlaylist,
  detailsActions,
  editPlaylist,
  moveAction,
  removeActions,
  removeCoverAction,
  uploadCover,
  type PlaylistDetails,
  type PlaylistItem,
} from "./edit.ts";
import {
  fetchSignatureTimestamp,
  getPlaybackTracking,
  newCpn,
  playbackPing,
  watchtimePing,
  type Play,
  type WatchReport,
} from "./history.ts";
import { inProcessPlayerScript, LIBRARY_VERSION } from "./player-extract.ts";
import { currentPlayerId, type PlayerScript, type PlayerScriptSource } from "./player-script.ts";
import { type BotGuardVm, PoTokenMinter } from "./po-token.ts";
import { FREE_BEST_ITAG, isSubscriber, PREMIUM_ITAGS } from "./premium.ts";
import { getMix, getRadio, getSongYear } from "./radio.ts";
import { setRating, type Rating } from "./rating.ts";
import { getServerQueue, setServerQueue, type ServerQueue } from "./resume.ts";
import { searchMusic, type SearchMore } from "./search.ts";
import {
  getSearchHistory,
  removeSearchHistory,
  type SearchHistoryEntry,
} from "./search-history.ts";
import { watchSession } from "./session.ts";
import { NotPlayableError, resolveStream } from "./stream.ts";

/**
 * How long one fallback session is reused. Its token is bound to a visitor id,
 * and the integrity token behind it lasts twelve hours; half that leaves room.
 */
const FALLBACK_SESSION_MS = 6 * 60 * 60 * 1000;

/** Playlists and searches that can be left half loaded and still resumed. */
const MAX_CONTINUATIONS = 16;

/** Plays still being reported on. Two is typical: the one ending and the next. */
const MAX_PLAYS = 4;

/** YouTube ships a new player script every few days; this is well inside that. */
const SIGNATURE_TIMESTAMP_MS = 12 * 60 * 60 * 1000;

/** A page fetcher held for the UI, which cannot hold the closure itself. */
type Continuation = PlaylistMore | SearchMore;

export interface ResolveOptions {
  /**
   * The player client of a lease that resolved fine but then failed to play
   * (a 403 on the stream shows up only in mpv, never here). Resolving starts
   * on the client after it.
   */
  refused?: string | null;
  quality?: AudioQuality;
}

/** Who is signed in, as far as the UI needs to show it. */
export interface AccountSummary {
  name: string;
  handle: string | null;
  photoUrl: string | null;
}

/**
 * Everything the app asks of YouTube, behind one object.
 *
 * It is the unit that runs in the worker, so its methods take and return only
 * structured-cloneable values (ids, strings, `Track`s, leases), never a
 * youtubei.js object. That rule is what keeps the worker boundary a detail:
 * the same class runs on the main thread in tests with nothing changed.
 */
export class YouTubeEngine {
  readonly #fetch: FetchLike;
  #cookie: string | null = null;
  #browse: Promise<Innertube> | null = null;
  #anonymous: Promise<Innertube> | null = null;
  #player: Promise<Innertube> | null = null;
  #signedInPlayer: Promise<Innertube> | null = null;
  readonly #playerScriptSource: PlayerScriptSource;
  #playerScript: Promise<PlayerScript> | null = null;
  /** Whether the account has Premium, null when the page did not say. */
  #premium: Promise<boolean | null> | null = null;
  readonly #minter: PoTokenMinter | null;
  readonly #onSessionExpired: () => void;
  #fallback: { youtube: Promise<Innertube>; expiresAt: number } | null = null;
  #signatureTimestamp: { value: Promise<number>; expiresAt: number } | null = null;
  readonly #continuations = new Map<string, Continuation>();
  readonly #plays = new Map<string, Play>();
  #handles = 0;
  /** The cookie the signed-in browsing client sends, which `renewCookie` updates. */
  #sending: { cookie: string } | null = null;

  /**
   * Without `botguard` there is no fallback, and resolving uses `VISIONOS` only.
   * `onSessionExpired` is called once when YouTube stops accepting the cookie;
   * the engine is signed out by then. `playerScript` analyses YouTube's player
   * script somewhere other than here, as doing it here keeps about 200 MB
   * resident for good; without it the engine does it in place.
   */
  constructor(
    fetch: FetchLike,
    botguard?: BotGuardVm,
    onSessionExpired: () => void = () => {},
    playerScript?: PlayerScriptSource,
  ) {
    this.#fetch = fetch;
    this.#playerScriptSource = playerScript ?? inProcessPlayerScript(fetch);
    this.#minter = botguard ? new PoTokenMinter(fetch, botguard) : null;
    this.#onSessionExpired = onSessionExpired;
  }

  /**
   * Signs the browsing client and the `WEB_REMIX` player client in or out.
   * The other player clients stay anonymous: a web session's cookie on a
   * non-web client is exactly the mismatch YouTube flags.
   */
  setCookie(cookie: string | null): void {
    if (cookie === this.#cookie) return;
    this.#cookie = cookie;
    this.#browse = null;
    this.#sending = null;
    this.#signedInPlayer = null;
    this.#premium = null;
  }

  /**
   * Swaps in a rotated copy of the session signed in with: the same account,
   * so the browsing client is kept and only the cookie it sends changes.
   * Ignored while signed out.
   */
  renewCookie(cookie: string): void {
    if (this.#cookie === null) return;
    this.#cookie = cookie;
    if (this.#sending) this.#sending.cookie = cookie;
  }

  /** None when signed out. Rejects when the saved session has expired. */
  async account(): Promise<AccountSummary | null> {
    if (this.#cookie === null) return null;
    const accounts = await (await this.#browseClient()).account.getInfo(true);
    const active = accounts.find((a) => a.is_selected) ?? accounts[0];
    if (!active) throw new Error("YouTube did not accept the saved session");
    const handle = active.channel_handle?.toString() ?? "";
    return {
      name: active.account_name.toString(),
      handle: handle.length > 0 ? handle : null,
      photoUrl: largestPhoto(active.account_photo),
    };
  }

  /**
   * `signedOut` searches without the account, which keeps the query out of its
   * YouTube search history. It is how search history on this device, or off,
   * works: YouTube's own pause is an account setting the app cannot reach.
   */
  async search(
    query: string,
    {
      signedOut = false,
      filter = null,
    }: { signedOut?: boolean; filter?: SearchFilter | null } = {},
  ): Promise<{ results: SearchResults; more: string | null }> {
    const youtube = signedOut ? await this.#anonymousClient() : await this.#browseClient();
    const { results, more } = await searchMusic(youtube, query, filter);
    return { results, more: this.#hold(more) };
  }

  /** The next page of a chip's results, from the handle `search` or this returned. */
  async searchMore(handle: string): Promise<{ results: SearchResults; more: string | null }> {
    const { results, more } = await this.#fetchMore<SearchMore>(handle, "search");
    return { results, more: this.#hold(more) };
  }

  /** The account's recent searches, newest first. Empty when signed out. */
  async searchHistory(): Promise<SearchHistoryEntry[]> {
    if (this.#cookie === null) return [];
    return getSearchHistory(await this.#browseClient());
  }

  async removeSearchHistory(feedbackToken: string): Promise<void> {
    await removeSearchHistory(await this.#signedIn(), feedbackToken);
  }

  /** Songs YouTube Music would play after `videoId`, for autoplay and song radio. */
  async radio(videoId: VideoId): Promise<Track[]> {
    return getRadio(await this.#browseClient(), videoId);
  }

  /** The year a song's album came out, for the player's byline. */
  async songYear(videoId: VideoId): Promise<number | null> {
    return getSongYear(await this.#browseClient(), videoId);
  }

  /**
   * "Start mix" on a list: `playlistId` is the radio playlist (`RDAMPL…`,
   * `RDEM…`) and `videoId`, when the button names one, the song it opens on.
   */
  async mix(playlistId: string, videoId: string | null = null): Promise<Track[]> {
    return getMix(await this.#browseClient(), playlistId, videoId);
  }

  /** Saves an album or playlist to the library, or removes it. `id` is the bare playlist id. */
  async setSaved(id: string, saved: boolean): Promise<void> {
    const youtube = await this.#signedIn();
    if (saved) await youtube.playlist.addToLibrary(id);
    else await youtube.playlist.removeFromLibrary(id);
  }

  async setSubscribed(channelId: string, subscribed: boolean): Promise<void> {
    const youtube = await this.#signedIn();
    if (subscribed) await youtube.interact.subscribe(channelId);
    else await youtube.interact.unsubscribe(channelId);
  }

  /** Your playlists that songs can be added to, found through `videoId`. */
  async playlistTargets(videoId: VideoId): Promise<PlaylistTarget[]> {
    return getPlaylistTargets(await this.#signedIn(), videoId);
  }

  /** Creates a playlist holding `videoIds`, and returns its id. */
  async createPlaylist(playlist: NewPlaylist, videoIds: VideoId[]): Promise<string> {
    return createPlaylist(await this.#signedIn(), playlist, videoIds);
  }

  async addToPlaylist(playlistId: string, videoIds: VideoId[]): Promise<void> {
    if (videoIds.length === 0) return;
    await (await this.#signedIn()).playlist.addVideos(playlistId, videoIds);
  }

  /** Renames one of your playlists, or changes its description or who can see it. */
  async editPlaylist(playlistId: string, details: PlaylistDetails): Promise<void> {
    await editPlaylist(await this.#signedIn(), playlistId, detailsActions(details));
  }

  /**
   * Makes `image` (a square JPEG, at least 360 pixels a side) the playlist's
   * cover. Answers with the cover as YouTube now serves it.
   */
  async setPlaylistCover(playlistId: string, image: Uint8Array<ArrayBuffer>): Promise<Thumbnail[]> {
    const youtube = await this.#signedIn();
    const blobId = await uploadCover(youtube, image);
    return coverOf(await editPlaylist(youtube, playlistId, [coverAction(blobId)]));
  }

  /** Drops a custom cover. Answers with the one YouTube serves instead. */
  async removePlaylistCover(playlistId: string): Promise<Thumbnail[]> {
    return coverOf(await editPlaylist(await this.#signedIn(), playlistId, [removeCoverAction()]));
  }

  async removeFromPlaylist(playlistId: string, items: PlaylistItem[]): Promise<void> {
    await editPlaylist(await this.#signedIn(), playlistId, removeActions(items));
  }

  /** Moves the row `itemId` to just before `beforeItemId`, or to the end when that is null. */
  async moveInPlaylist(
    playlistId: string,
    itemId: string,
    beforeItemId: string | null,
  ): Promise<void> {
    await editPlaylist(await this.#signedIn(), playlistId, [moveAction(itemId, beforeItemId)]);
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await deletePlaylist(await this.#signedIn(), playlistId);
  }

  /**
   * Tells YouTube a song started playing, which adds it to the account's
   * history. Returns a handle for the watch-time reports that follow, or null
   * when signed out or YouTube gave nothing to report to.
   */
  async played(videoId: VideoId, playlistId: string | null = null): Promise<string | null> {
    if (this.#cookie === null) return null;
    const list = playlistId ? playlistIdFromBrowseId(playlistId) : null;
    const tracking = await getPlaybackTracking(
      await this.#browseClient(),
      videoId,
      await this.#currentSignatureTimestamp(),
      list,
    );
    if (tracking === null) return null;
    const play: Play = {
      tracking,
      client: { name: Constants.CLIENTS.YTMUSIC.NAME, version: Constants.CLIENTS.YTMUSIC.VERSION },
      cpn: newCpn(),
      startedAt: Date.now(),
      playlistId: list,
    };
    await this.#stats(playbackPing(play, Date.now()));
    const handle = String(++this.#handles);
    this.#plays.set(handle, play);
    for (const old of this.#plays.keys()) {
      if (this.#plays.size <= MAX_PLAYS) break;
      this.#plays.delete(old);
    }
    return handle;
  }

  /** Reports what was listened to of a play `played` started. The final report ends it. */
  async watched(handle: string, report: WatchReport): Promise<void> {
    const play = this.#plays.get(handle);
    if (!play || this.#cookie === null) return;
    if (report.final) this.#plays.delete(handle);
    await this.#stats(watchtimePing(play, report, Date.now()));
  }

  /** The account's last queue, to resume from another device. Null when signed out or there is none. */
  async serverQueue(): Promise<ServerQueue | null> {
    if (this.#cookie === null) return null;
    return getServerQueue(await this.#browseClient());
  }

  /**
   * Makes a song the account's current queue, for "Resume" elsewhere, and
   * returns the account's rating of it. Nothing, and null, when signed out.
   */
  async shareQueue(videoId: VideoId, playlistId: string | null): Promise<Rating | null> {
    if (this.#cookie === null) return null;
    return setServerQueue(await this.#browseClient(), videoId, playlistId);
  }

  /** Likes or dislikes a song, or clears either. Liking adds it to Liked Music. */
  async rate(videoId: VideoId, rating: Rating): Promise<void> {
    await setRating(await this.#signedIn(), videoId, rating);
  }

  /**
   * youtubei.js signs only InnerTube calls, so a stats request through it
   * would go out anonymous. The session cookie is what files it under the
   * account.
   */
  async #stats(url: string): Promise<void> {
    const response = await this.#fetch(url, { headers: { Cookie: this.#cookie ?? "" } });
    if (!response.ok) throw new Error(`YouTube refused a playback report: ${response.status}`);
  }

  async #signedIn(): Promise<Innertube> {
    if (this.#cookie === null) throw new Error("sign in to YouTube Music first");
    return this.#browseClient();
  }

  /** `id` is an album's browse id (`MPREb_…`). */
  async album(id: string): Promise<AlbumPage> {
    return getAlbum(await this.#browseClient(), id);
  }

  /** `id` is the artist's channel id (`UC…`). */
  async artist(id: string): Promise<ArtistPage> {
    return getArtist(await this.#browseClient(), id);
  }

  /**
   * `id` with or without the `VL` browse prefix. Returns the first page of
   * rows; `more`, when set, is a handle for `playlistMore` to fetch the next.
   */
  async playlist(id: string): Promise<{ page: PlaylistPage; more: string | null }> {
    const { page, more } = await openPlaylist(await this.#browseClient(), id);
    return { page, more: this.#hold(more) };
  }

  async playlistMore(
    handle: string,
  ): Promise<{ tracks: Track[]; itemIds: (string | null)[]; more: string | null }> {
    const { tracks, itemIds, more } = await this.#fetchMore<PlaylistMore>(handle, "playlist");
    return { tracks, itemIds, more: this.#hold(more) };
  }

  /**
   * A continuation is a youtubei.js closure and cannot cross the worker
   * boundary, so it stays here under a handle. Only the newest few are kept:
   * one abandoned per playlist or search left half loaded is not worth
   * holding forever.
   */
  #hold(more: Continuation | null): string | null {
    if (more === null) return null;
    const handle = String(++this.#handles);
    this.#continuations.set(handle, more);
    for (const old of this.#continuations.keys()) {
      if (this.#continuations.size <= MAX_CONTINUATIONS) break;
      this.#continuations.delete(old);
    }
    return handle;
  }

  /** Fetches a held page. Dropped only once fetched, so a page that failed can be asked for again. */
  async #fetchMore<C extends Continuation>(
    handle: string,
    what: "playlist" | "search",
  ): Promise<Awaited<ReturnType<C>>> {
    const next = this.#continuations.get(handle) as C | undefined;
    if (!next) throw new Error(`this ${what} page has expired; open it again`);
    const page = (await next()) as Awaited<ReturnType<C>>;
    this.#continuations.delete(handle);
    return page;
  }

  /** The signed-in account's playlists, Liked Music first. Empty when signed out. */
  async libraryPlaylists(): Promise<BrowseCard[]> {
    if (this.#cookie === null) return [];
    return getLibraryPlaylists(await this.#browseClient());
  }

  /**
   * The account's playlists, saved albums or library artists, in `sort`, one
   * of the orders YouTube offers for the list, or its default. Empty when
   * signed out.
   */
  async libraryCards(kind: LibraryKind, sort?: string): Promise<LibraryCards> {
    if (this.#cookie === null) return { cards: [], sorts: [], sort: null };
    return getLibraryCards(await this.#browseClient(), kind, sort);
  }

  /**
   * The songs saved to the library, in `sort`, the first page of them; `more`,
   * when set, is a handle for `playlistMore` to fetch the next. Empty when
   * signed out.
   */
  async librarySongs(
    sort?: string,
  ): Promise<{ tracks: Track[]; more: string | null; sorts: string[]; sort: string | null }> {
    if (this.#cookie === null) return { tracks: [], more: null, sorts: [], sort: null };
    const songs = await openLibrarySongs(await this.#browseClient(), sort);
    return { ...songs, more: this.#hold(songs.more) };
  }

  /**
   * Signed in, `WEB_REMIX` first: it is the only client that serves Premium's
   * formats as plain URLs, and the one YouTube Music's own site plays through.
   * Then `VISIONOS`, which needs no token and no evaluator, so it is fast and
   * has the fewest moving parts. Then the PO-token client. Anything that goes
   * wrong on one, short of YouTube saying the video is gone, is retried on the
   * next.
   */
  async resolve(videoId: VideoId, options: ResolveOptions = {}): Promise<StreamLease> {
    const quality = options.quality ?? "high";
    const clients = this.#playerClients();
    // A client not in the list (one from before signing in, say) skips the first.
    const tries =
      options.refused == null
        ? clients
        : clients.slice(clients.findIndex((c) => c.name === options.refused) + 1 || 1);
    if (tries.length === 0) throw new Error(`no player client left after ${options.refused}`);
    const errors: unknown[] = [];
    for (const { name, resolve } of tries) {
      try {
        const lease = await this.#judge(await resolve(videoId, quality), quality);
        console.info(`resolved ${videoId} as itag ${lease.itag} through ${lease.playerClient}`);
        return lease;
      } catch (error) {
        if (isGone(error)) throw error;
        console.warn(`${name} could not resolve ${videoId}: ${describe(error)}`);
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    throw new AggregateError(
      errors,
      `could not resolve a stream: ${errors.map(describe).join("; then ")}`,
    );
  }

  #playerClients(): PlayerClient[] {
    const clients: PlayerClient[] = [];
    if (this.#cookie !== null) {
      clients.push({
        name: ClientType.MUSIC,
        resolve: async (videoId, quality) =>
          resolveStream(await this.#signedInPlayerClient(), videoId, { quality, music: true }),
      });
    }
    clients.push({
      name: ClientType.VISIONOS,
      resolve: async (videoId, quality) =>
        resolveStream(await this.#playerClient(), videoId, { quality }),
    });
    const minter = this.#minter;
    if (minter !== null) {
      clients.push({
        name: ClientType.TV_SIMPLY,
        resolve: async (videoId, quality) =>
          resolveStream(await this.#fallbackClient(minter), videoId, {
            quality,
            poToken: await minter.mint(videoId),
          }),
      });
    }
    return clients;
  }

  /**
   * Marks a lease degraded when a signed-in account on "high" got less than
   * its best because `WEB_REMIX` did not serve it: anything but a Premium
   * format for a Premium account, anything below Opus 251 for a free one.
   * "normal" and "low" pick the same formats on every client, so a fallback
   * there sounds the same and is not worth mentioning.
   */
  async #judge(lease: StreamLease, quality: AudioQuality): Promise<StreamLease> {
    if (lease.isPremiumFormat) this.#premium = Promise.resolve(true);
    if (this.#cookie === null || quality !== "high" || lease.playerClient === ClientType.MUSIC) {
      return lease;
    }
    const premium = await this.#isPremium();
    const best = premium ? PREMIUM_ITAGS : [...PREMIUM_ITAGS, FREE_BEST_ITAG];
    if (lease.itag !== null && best.includes(lease.itag)) return lease;
    return { ...lease, degraded: degradedReason(lease, premium === true) };
  }

  /** Asked once per sign-in, and only when a fallback needs judging. */
  #isPremium(): Promise<boolean | null> {
    const cookie = this.#cookie;
    if (cookie === null) return Promise.resolve(null);
    this.#premium ??= isSubscriber(this.#fetch, cookie).catch((error: unknown) => {
      console.warn(`could not tell whether the account has Premium: ${describe(error)}`);
      this.#premium = null;
      return null;
    });
    return this.#premium;
  }

  /**
   * Created once: `Innertube.create` is a network round trip for session
   * context, so one per search would cost more than the search.
   */
  #browseClient(): Promise<Innertube> {
    this.#browse ??= retryable(this.#createBrowseClient(this.#cookie), () => {
      this.#browse = null;
    });
    return this.#browse;
  }

  #createBrowseClient(cookie: string | null): Promise<Innertube> {
    if (cookie === null) return createYouTube({ fetch: this.#fetch });
    // Each request carries the client's cookie as it is now: a rotation
    // changes it under a client built with an older copy.
    const sending = { cookie };
    this.#sending = sending;
    const fetch: FetchLike = (input, init) => {
      const sent = sending.cookie;
      const headers = new Headers(init?.headers);
      if (headers.has("cookie")) headers.set("cookie", sent);
      return watchSession(this.#fetch, (path) => this.#expired(sent, path))(input, {
        ...init,
        headers,
      });
    };
    return createYouTube({ fetch, cookie });
  }

  /** Only for the cookie YouTube refused, not one rotated or signed in since. */
  #expired(cookie: string, path: string): void {
    if (cookie !== this.#cookie) return;
    console.warn(`YouTube answered ${path} as signed out`);
    this.setCookie(null);
    this.#onSessionExpired();
  }

  /** The browsing client without the cookie. The same one while signed out. */
  #anonymousClient(): Promise<Innertube> {
    if (this.#cookie === null) return this.#browseClient();
    this.#anonymous ??= retryable(createYouTube({ fetch: this.#fetch }), () => {
      this.#anonymous = null;
    });
    return this.#anonymous;
  }

  /**
   * YouTube's player script, analysed, which every player client deciphers
   * with. Fetched once for the engine's life, as the clients were before: the
   * slowest step on the whole path. Held as a promise so two tracks resolving
   * together share one.
   */
  #analysedPlayerScript(): Promise<PlayerScript> {
    this.#playerScript ??= retryable(
      (async () => this.#playerScriptSource(await currentPlayerId(this.#fetch), LIBRARY_VERSION))(),
      () => {
        this.#playerScript = null;
      },
    );
    return this.#playerScript;
  }

  /** Also created once, held as a promise for the same reason. */
  #playerClient(): Promise<Innertube> {
    this.#player ??= retryable(createPlayer({ fetch: this.#fetch }), () => {
      this.#player = null;
    });
    return this.#player;
  }

  #currentSignatureTimestamp(): Promise<number> {
    if (this.#signatureTimestamp === null || this.#signatureTimestamp.expiresAt <= Date.now()) {
      this.#signatureTimestamp = {
        value: retryable(fetchSignatureTimestamp(this.#fetch), () => {
          this.#signatureTimestamp = null;
        }),
        expiresAt: Date.now() + SIGNATURE_TIMESTAMP_MS,
      };
    }
    return this.#signatureTimestamp.value;
  }

  /**
   * The signed-in `WEB_REMIX` client, created once per sign-in. Each request
   * carries the session as it is now, as the browsing client's do, so a
   * rotation reaches it too.
   */
  #signedInPlayerClient(): Promise<Innertube> {
    const cookie = this.#cookie;
    if (cookie === null) return Promise.reject(new Error("sign in to YouTube Music first"));
    const fetch: FetchLike = (input, init) => {
      const headers = new Headers(init?.headers);
      if (headers.has("cookie") && this.#cookie !== null) headers.set("cookie", this.#cookie);
      return this.#fetch(input, { ...init, headers });
    };
    this.#signedInPlayer ??= retryable(
      (async () =>
        createSignedInPlayer({ fetch, cookie, script: await this.#analysedPlayerScript() }))(),
      () => {
        this.#signedInPlayer = null;
      },
    );
    return this.#signedInPlayer;
  }

  #fallbackClient(minter: PoTokenMinter): Promise<Innertube> {
    if (this.#fallback === null || this.#fallback.expiresAt <= Date.now()) {
      const youtube = (async () => {
        const visitorData = await createVisitor({ fetch: this.#fetch });
        return createFallbackPlayer({
          fetch: this.#fetch,
          visitorData,
          sessionToken: await minter.mint(visitorData),
          script: await this.#analysedPlayerScript(),
        });
      })();
      this.#fallback = {
        youtube: retryable(youtube, () => {
          this.#fallback = null;
        }),
        expiresAt: Date.now() + FALLBACK_SESSION_MS,
      };
    }
    return this.#fallback.youtube;
  }
}

interface PlayerClient {
  name: string;
  resolve: (videoId: VideoId, quality: AudioQuality) => Promise<StreamLease>;
}

const CODEC_NAMES: Partial<Record<StreamLease["codec"], string>> = { opus: "Opus", aac: "AAC" };

/** The tooltip for a degraded song, in the listener's terms. */
export function degradedReason(lease: StreamLease, premium: boolean): string {
  const codec = CODEC_NAMES[lease.codec] ?? lease.codec;
  const playing = lease.bitrate
    ? `${Math.round(lease.bitrate / 1000)} kbps ${codec}`
    : `${codec} (itag ${lease.itag})`;
  const best = premium ? "Premium's 256 kbps" : "160 kbps Opus";
  return `Playing at ${playing} instead of ${best}. YouTube Music's web player would not play this song, so it came through another client.`;
}

/** YouTube's "this video does not exist": no client will do better. */
function isGone(error: unknown): boolean {
  return error instanceof NotPlayableError && error.status === "ERROR";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A rejected creation left cached would be reused forever, so one failed
 * startup (offline for a moment, say) would break the engine for the rest of
 * the run. Forget it on failure and let the next call try again.
 */
function retryable<T>(promise: Promise<T>, forget: () => void): Promise<T> {
  return promise.catch((error: unknown) => {
    forget();
    throw error;
  });
}

/** Account photos arrive protocol-relative (`//yt3.ggpht.com/...`) at times. */
function largestPhoto(photos: readonly { url: string; width: number }[]): string | null {
  const largest = photos.reduce<{ url: string; width: number } | null>(
    (best, photo) => (best === null || photo.width > best.width ? photo : best),
    null,
  );
  if (!largest) return null;
  return largest.url.startsWith("//") ? `https:${largest.url}` : largest.url;
}
