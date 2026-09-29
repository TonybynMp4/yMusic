import type {
  AlbumPage,
  AudioQuality,
  ArtistPage,
  BrowseCard,
  PlaylistPage,
  StreamLease,
  Track,
  VideoId,
} from "@ymusic/core";
import { Constants, type Innertube } from "youtubei.js";

import {
  createFallbackPlayer,
  createPlayer,
  createVisitor,
  createYouTube,
  type FetchLike,
} from "./client.ts";
import {
  createPlaylist,
  getAlbum,
  getArtist,
  getLibraryPlaylists,
  getPlaylistTargets,
  openPlaylist,
  type NewPlaylist,
  type PlaylistMore,
  type PlaylistTarget,
} from "./browse.ts";
import {
  getPlaybackTracking,
  newCpn,
  playbackPing,
  watchtimePing,
  type Play,
  type WatchReport,
} from "./history.ts";
import { type BotGuardVm, PoTokenMinter } from "./po-token.ts";
import { getMix, getRadio } from "./radio.ts";
import { getServerQueue, setServerQueue, type ServerQueue } from "./resume.ts";
import { searchSongs } from "./search.ts";
import { NotPlayableError, resolveStream } from "./stream.ts";

/**
 * How long one fallback session is reused. Its token is bound to a visitor id,
 * and the integrity token behind it lasts twelve hours; half that leaves room.
 */
const FALLBACK_SESSION_MS = 6 * 60 * 60 * 1000;

/** Playlists that can be left half loaded and still resumed. */
const MAX_CONTINUATIONS = 16;

/** Plays still being reported on. Two is typical: the one ending and the next. */
const MAX_PLAYS = 4;

export interface ResolveOptions {
  /**
   * Skip straight to the PO-token client. For when a lease the usual client
   * issued resolved fine but then failed to play: a 403 on the stream shows
   * up only in mpv, never here.
   */
  fallback?: boolean;
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
  #player: Promise<Innertube> | null = null;
  readonly #minter: PoTokenMinter | null;
  #fallback: { youtube: Promise<Innertube>; expiresAt: number } | null = null;
  readonly #continuations = new Map<string, PlaylistMore>();
  readonly #plays = new Map<string, Play>();
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

  /**
   * Tells YouTube a song started playing, which adds it to the account's
   * history. Returns a handle for the watch-time reports that follow, or null
   * when signed out or YouTube gave nothing to report to.
   */
  async played(videoId: VideoId): Promise<string | null> {
    if (this.#cookie === null) return null;
    const player = (await this.#playerClient()).session.player;
    if (!player) throw new Error("the player script is not loaded");
    const tracking = await getPlaybackTracking(
      await this.#browseClient(),
      videoId,
      player.signature_timestamp,
    );
    if (tracking === null) return null;
    const play: Play = {
      tracking,
      client: { name: Constants.CLIENTS.YTMUSIC.NAME, version: Constants.CLIENTS.YTMUSIC.VERSION },
      cpn: newCpn(),
      startedAt: Date.now(),
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

  /** Makes a song the account's current queue, for "Resume" elsewhere. Nothing when signed out. */
  async shareQueue(videoId: VideoId, playlistId: string | null): Promise<void> {
    if (this.#cookie === null) return;
    await setServerQueue(await this.#browseClient(), videoId, playlistId);
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
    const quality = options.quality ?? "high";
    if (options.fallback) return this.#resolveWithToken(videoId, quality);
    try {
      return await resolveStream(await this.#playerClient(), videoId, { quality });
    } catch (error) {
      if (this.#minter === null || isGone(error)) throw error;
      try {
        return await this.#resolveWithToken(videoId, quality);
      } catch (fallbackError) {
        throw new AggregateError(
          [error, fallbackError],
          `could not resolve a stream: ${describe(error)}; fallback: ${describe(fallbackError)}`,
        );
      }
    }
  }

  async #resolveWithToken(videoId: VideoId, quality: AudioQuality): Promise<StreamLease> {
    const minter = this.#minter;
    if (minter === null) throw new Error("no BotGuard to mint a PO token with");
    const youtube = await this.#fallbackClient(minter);
    return resolveStream(youtube, videoId, { quality, poToken: await minter.mint(videoId) });
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
