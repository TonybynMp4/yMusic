import type {
  AlbumPage,
  ArtistPage,
  BrowseCard,
  PlaylistPage,
  StreamLease,
  Track,
  VideoId,
} from "@ytbm/core";
import type { Innertube } from "youtubei.js";

import {
  createFallbackPlayer,
  createPlayer,
  createVisitor,
  createYouTube,
  type FetchLike,
} from "./client.ts";
import {
  getAlbum,
  getArtist,
  getLibraryPlaylists,
  openPlaylist,
  type PlaylistMore,
} from "./browse.ts";
import { type BotGuardVm, PoTokenMinter } from "./po-token.ts";
import { getRadio } from "./radio.ts";
import { searchSongs } from "./search.ts";
import { NotPlayableError, resolveStream } from "./stream.ts";

/**
 * How long one fallback session is reused. Its token is bound to a visitor id,
 * and the integrity token behind it lasts twelve hours; half that leaves room.
 */
const FALLBACK_SESSION_MS = 6 * 60 * 60 * 1000;

/** Playlists that can be left half loaded and still resumed. */
const MAX_CONTINUATIONS = 16;

export interface ResolveOptions {
  /**
   * Skip straight to the PO-token client. For when a lease the usual client
   * issued resolved fine but then failed to play: a 403 on the stream shows
   * up only in mpv, never here.
   */
  fallback?: boolean;
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
  #player: Promise<Innertube> | null = null;
  readonly #minter: PoTokenMinter | null;
  #fallback: { youtube: Promise<Innertube>; expiresAt: number } | null = null;
  readonly #continuations = new Map<string, PlaylistMore>();
  #handles = 0;

  /** Without `botguard` there is no fallback, and resolving uses `VISIONOS` only. */
  constructor(fetch: FetchLike, botguard?: BotGuardVm) {
    this.#fetch = fetch;
    this.#minter = botguard ? new PoTokenMinter(fetch, botguard) : null;
  }

  /**
   * Signs the browsing client in or out. Only that client: the player client
   * impersonates VISIONOS, and a web session's cookie on a non-web client is
   * exactly the mismatch YouTube flags, so playback stays anonymous. It
   * needs no account for anything the app plays today.
   */
  setCookie(cookie: string | null): void {
    if (cookie === this.#cookie) return;
    this.#cookie = cookie;
    this.#browse = null;
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

  async search(query: string): Promise<Track[]> {
    return searchSongs(await this.#browseClient(), query);
  }

  /** Songs YouTube Music would play after `videoId`, for autoplay and song radio. */
  async radio(videoId: VideoId): Promise<Track[]> {
    return getRadio(await this.#browseClient(), videoId);
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

  async playlistMore(handle: string): Promise<{ tracks: Track[]; more: string | null }> {
    const next = this.#continuations.get(handle);
    if (!next) throw new Error("this playlist page has expired; reopen the playlist");
    this.#continuations.delete(handle);
    const { tracks, more } = await next();
    return { tracks, more: this.#hold(more) };
  }

  /**
   * A continuation is a youtubei.js closure and cannot cross the worker
   * boundary, so it stays here under a handle. Only the newest few are kept:
   * one abandoned per playlist left half loaded is not worth holding forever.
   */
  #hold(more: PlaylistMore | null): string | null {
    if (more === null) return null;
    const handle = String(++this.#handles);
    this.#continuations.set(handle, more);
    for (const old of this.#continuations.keys()) {
      if (this.#continuations.size <= MAX_CONTINUATIONS) break;
      this.#continuations.delete(old);
    }
    return handle;
  }

  /** The signed-in account's playlists, Liked Music first. Empty when signed out. */
  async libraryPlaylists(): Promise<BrowseCard[]> {
    if (this.#cookie === null) return [];
    return getLibraryPlaylists(await this.#browseClient());
  }

  /**
   * `VISIONOS` first: it needs no token and no evaluator, so it is fast and has
   * the fewest moving parts. Anything that goes wrong there, short of YouTube
   * saying the video is gone, is retried on the PO-token client.
   */
  async resolve(videoId: VideoId, options: ResolveOptions = {}): Promise<StreamLease> {
    if (options.fallback) return this.#resolveWithToken(videoId);
    try {
      return await resolveStream(await this.#playerClient(), videoId);
    } catch (error) {
      if (this.#minter === null || isGone(error)) throw error;
      try {
        return await this.#resolveWithToken(videoId);
      } catch (fallbackError) {
        throw new AggregateError(
          [error, fallbackError],
          `could not resolve a stream: ${describe(error)}; fallback: ${describe(fallbackError)}`,
        );
      }
    }
  }

  async #resolveWithToken(videoId: VideoId): Promise<StreamLease> {
    const minter = this.#minter;
    if (minter === null) throw new Error("no BotGuard to mint a PO token with");
    const youtube = await this.#fallbackClient(minter);
    return resolveStream(youtube, videoId, await minter.mint(videoId));
  }

  /**
   * Created once: `Innertube.create` is a network round trip for session
   * context, so one per search would cost more than the search.
   */
  #browseClient(): Promise<Innertube> {
    this.#browse ??= retryable(
      createYouTube({ fetch: this.#fetch, cookie: this.#cookie ?? undefined }),
      () => {
        this.#browse = null;
      },
    );
    return this.#browse;
  }

  /**
   * Also created once, and more importantly so: it downloads and interprets
   * YouTube's player JavaScript, the slowest step on the whole path. Held as a
   * promise so two tracks resolving together share one creation.
   */
  #playerClient(): Promise<Innertube> {
    this.#player ??= retryable(createPlayer({ fetch: this.#fetch }), () => {
      this.#player = null;
    });
    return this.#player;
  }

  #fallbackClient(minter: PoTokenMinter): Promise<Innertube> {
    if (this.#fallback === null || this.#fallback.expiresAt <= Date.now()) {
      const youtube = (async () => {
        const visitorData = await createVisitor({ fetch: this.#fetch });
        return createFallbackPlayer({
          fetch: this.#fetch,
          visitorData,
          sessionToken: await minter.mint(visitorData),
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
