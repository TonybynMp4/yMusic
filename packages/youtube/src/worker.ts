/**
 * The worker's half of the engine. A worker entry file only needs to import
 * this module and call `exposeEngine()`.
 */

import { expose, transfer, type Endpoint, type Remote } from "comlink";

import type { FetchLike } from "./client.ts";
import { YouTubeEngine } from "./engine.ts";
import type { PlayerScriptSource } from "./player-script.ts";
import type { BotGuardVm } from "./po-token.ts";
import { deserializeResponse, serializeRequest } from "./remote-fetch.ts";
import type { EngineHost, EngineWorkerApi } from "./rpc.ts";

/** `endpoint` defaults to the worker's own scope; tests pass a `MessagePort`. */
export function exposeEngine(endpoint: Endpoint = self as unknown as Endpoint): void {
  let host: Remote<EngineHost> | null = null;
  const connected = (): Remote<EngineHost> => {
    if (host === null) throw new Error("the engine worker was used before `connect`");
    return host;
  };

  const fetch: FetchLike = async (input, init) => {
    const request = await serializeRequest(input, init);
    const response = await connected().fetch(
      request.body ? transfer(request, [request.body]) : request,
    );
    return deserializeResponse(response);
  };
  const botguard: BotGuardVm = {
    load: (challenge) => connected().botguardLoad(challenge),
    createMinter: (integrityToken) => connected().botguardCreateMinter(integrityToken),
    mint: (binding) => connected().botguardMint(binding),
  };
  const sessionExpired = () => void connected().sessionExpired();
  const playerScript: PlayerScriptSource = (playerId, libraryVersion) =>
    connected().playerScript(playerId, libraryVersion);
  let engine = new YouTubeEngine(fetch, undefined, sessionExpired);

  const api: EngineWorkerApi = {
    connect(remote, offers) {
      host = remote;
      engine = new YouTubeEngine(
        fetch,
        offers.botguard ? botguard : undefined,
        sessionExpired,
        offers.playerScript ? playerScript : undefined,
      );
    },
    setCookie: (cookie) => engine.setCookie(cookie),
    renewCookie: (cookie) => engine.renewCookie(cookie),
    account: () => engine.account(),
    search: (query, options) => engine.search(query, options),
    searchMore: (handle) => engine.searchMore(handle),
    searchHistory: () => engine.searchHistory(),
    removeSearchHistory: (token) => engine.removeSearchHistory(token),
    radio: (videoId) => engine.radio(videoId),
    songYear: (videoId) => engine.songYear(videoId),
    album: (id) => engine.album(id),
    artist: (id) => engine.artist(id),
    playlist: (id) => engine.playlist(id),
    playlistMore: (handle) => engine.playlistMore(handle),
    libraryPlaylists: () => engine.libraryPlaylists(),
    libraryCards: (kind, sort) => engine.libraryCards(kind, sort),
    librarySongs: (sort) => engine.librarySongs(sort),
    mix: (playlistId, videoId) => engine.mix(playlistId, videoId),
    setSaved: (id, saved) => engine.setSaved(id, saved),
    setSubscribed: (channelId, subscribed) => engine.setSubscribed(channelId, subscribed),
    playlistTargets: (videoId) => engine.playlistTargets(videoId),
    addToPlaylist: (playlistId, videoIds) => engine.addToPlaylist(playlistId, videoIds),
    createPlaylist: (playlist, videoIds) => engine.createPlaylist(playlist, videoIds),
    editPlaylist: (playlistId, details) => engine.editPlaylist(playlistId, details),
    setPlaylistCover: (playlistId, image) => engine.setPlaylistCover(playlistId, image),
    removePlaylistCover: (playlistId) => engine.removePlaylistCover(playlistId),
    removeFromPlaylist: (playlistId, items) => engine.removeFromPlaylist(playlistId, items),
    moveInPlaylist: (playlistId, itemId, beforeItemId) =>
      engine.moveInPlaylist(playlistId, itemId, beforeItemId),
    deletePlaylist: (playlistId) => engine.deletePlaylist(playlistId),
    resolve: (videoId, options) => engine.resolve(videoId, options),
    played: (videoId, playlistId) => engine.played(videoId, playlistId),
    watched: (handle, report) => engine.watched(handle, report),
    serverQueue: () => engine.serverQueue(),
    shareQueue: (videoId, playlistId) => engine.shareQueue(videoId, playlistId),
    rate: (videoId, rating) => engine.rate(videoId, rating),
  };
  expose(api, endpoint);
}
