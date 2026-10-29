import type { ProxyMarked, Remote } from "comlink";

import type { YouTubeEngine } from "./engine.ts";
import type { PlayerScriptSource } from "./player-script.ts";
import type { BotGuardVm } from "./po-token.ts";
import type { SerializedRequest, SerializedResponse } from "./remote-fetch.ts";

/**
 * What the main thread offers the worker: the network. See `remote-fetch.ts`
 * for why the worker cannot reach YouTube itself.
 */
export interface EngineHost {
  fetch(request: SerializedRequest): Promise<SerializedResponse>;
  /**
   * BotGuard, when the host has one. It needs a DOM, which a worker lacks, so
   * the host runs it in an isolated frame and relays. See `po-token.ts`.
   */
  botguardLoad: BotGuardVm["load"];
  botguardCreateMinter: BotGuardVm["createMinter"];
  botguardMint: BotGuardVm["mint"];
  /** YouTube stopped accepting the saved session; the engine has signed out. */
  sessionExpired(): void;
  /**
   * The analysed player script, when the host offers to produce it. See
   * `player-script.ts` for why the engine would rather not.
   */
  playerScript: PlayerScriptSource;
}

/** Which of the host's optional methods work. */
export interface EngineHostOffers {
  botguard: boolean;
  playerScript: boolean;
}

/** What the worker offers the main thread. */
export interface EngineWorkerApi {
  /**
   * Must be the first call; every other one fetches through the host. Comlink
   * unwraps a `proxy()`-marked argument into this remote on arrival. A method
   * `offers` leaves out rejects: without BotGuard there is no fallback, and
   * without `playerScript` the engine analyses the player script itself.
   */
  connect(host: Remote<EngineHost & ProxyMarked>, offers: EngineHostOffers): void;
  setCookie: YouTubeEngine["setCookie"];
  renewCookie: YouTubeEngine["renewCookie"];
  account: YouTubeEngine["account"];
  search: YouTubeEngine["search"];
  searchMore: YouTubeEngine["searchMore"];
  searchHistory: YouTubeEngine["searchHistory"];
  removeSearchHistory: YouTubeEngine["removeSearchHistory"];
  radio: YouTubeEngine["radio"];
  songYear: YouTubeEngine["songYear"];
  album: YouTubeEngine["album"];
  artist: YouTubeEngine["artist"];
  playlist: YouTubeEngine["playlist"];
  playlistMore: YouTubeEngine["playlistMore"];
  libraryPlaylists: YouTubeEngine["libraryPlaylists"];
  libraryCards: YouTubeEngine["libraryCards"];
  librarySongs: YouTubeEngine["librarySongs"];
  mix: YouTubeEngine["mix"];
  shuffle: YouTubeEngine["shuffle"];
  shuffleMore: YouTubeEngine["shuffleMore"];
  setSaved: YouTubeEngine["setSaved"];
  setSubscribed: YouTubeEngine["setSubscribed"];
  playlistTargets: YouTubeEngine["playlistTargets"];
  addToPlaylist: YouTubeEngine["addToPlaylist"];
  createPlaylist: YouTubeEngine["createPlaylist"];
  editPlaylist: YouTubeEngine["editPlaylist"];
  setPlaylistCover: YouTubeEngine["setPlaylistCover"];
  removePlaylistCover: YouTubeEngine["removePlaylistCover"];
  removeFromPlaylist: YouTubeEngine["removeFromPlaylist"];
  moveInPlaylist: YouTubeEngine["moveInPlaylist"];
  deletePlaylist: YouTubeEngine["deletePlaylist"];
  resolve: YouTubeEngine["resolve"];
  played: YouTubeEngine["played"];
  watched: YouTubeEngine["watched"];
  serverQueue: YouTubeEngine["serverQueue"];
  shareQueue: YouTubeEngine["shareQueue"];
  rate: YouTubeEngine["rate"];
}
