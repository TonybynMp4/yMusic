/**
 * The player script as data. Kept free of youtubei.js at runtime, as the
 * main thread imports it; `player-extract.ts` holds the part that parses.
 */

import type { Player } from "youtubei.js";

import type { FetchLike } from "./client.ts";

/**
 * What youtubei.js keeps of YouTube's player script once it has analysed it:
 * the `n` and signature transforms with their dependencies (about 180 KB of
 * source) and the signature timestamp. Plain data, so it crosses a worker
 * boundary and fits in `localStorage`.
 *
 * Getting here is the expensive part. The script is about 2.6 MB, and parsing
 * it takes the heap to about 200 MB, which the process keeps as resident
 * memory after the syntax tree is collected. So the long-lived engine worker
 * asks for one of these instead of parsing (see `PlayerScriptSource`), and the
 * desktop app produces it in a worker it throws away afterwards.
 */
export interface PlayerScript {
  playerId: string;
  signatureTimestamp: number;
  data: NonNullable<Player["data"]>;
}

/**
 * Produces the analysed player script for `playerId`. `libraryVersion` is the
 * youtubei.js version asking: a cached script from another version may not
 * match how this one runs it.
 */
export type PlayerScriptSource = (
  playerId: string,
  libraryVersion: string,
) => Promise<PlayerScript>;

/** The id of the player script YouTube currently serves, from the iframe API. */
export async function currentPlayerId(fetch: FetchLike): Promise<string> {
  const response = await fetch("https://www.youtube.com/iframe_api");
  if (!response.ok) throw new Error(`the iframe API answered ${response.status}`);
  const id = /player\\\/([\w-]+)\\\//.exec(await response.text())?.[1];
  if (!id) throw new Error("the iframe API names no player script");
  return id;
}

/** Where YouTube serves the player script `playerId`. */
export function playerScriptUrl(playerId: string): string {
  return `https://www.youtube.com/s/player/${playerId}/player_es6.vflset/en_US/base.js`;
}
