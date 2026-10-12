import { Player } from "youtubei.js";
import packageInfo from "youtubei.js/package.json" with { type: "json" };

import type { FetchLike } from "./client.ts";
import { playerScriptUrl, type PlayerScript, type PlayerScriptSource } from "./player-script.ts";

export const LIBRARY_VERSION: string = packageInfo.version;

/** Analyses the player script's source, which is what costs the memory. */
export async function extractPlayerScript(playerId: string, source: string): Promise<PlayerScript> {
  const player = await Player.create(undefined, async () => new Response(source), undefined, playerId);
  if (!player.data) throw new Error("youtubei.js extracted nothing from the player script");
  return { playerId, signatureTimestamp: player.signature_timestamp, data: player.data };
}

/** The source for when nothing better is offered: fetch and analyse in place. */
export function inProcessPlayerScript(fetch: FetchLike): PlayerScriptSource {
  return async (playerId) => {
    const response = await fetch(playerScriptUrl(playerId));
    if (!response.ok) throw new Error(`the player script answered ${response.status}`);
    return extractPlayerScript(playerId, await response.text());
  };
}

/** A youtubei.js `Player` over an analysed script, one per client. */
export function playerFrom(script: PlayerScript, poToken?: string): Player {
  const player = new Player(script.playerId, script.signatureTimestamp, script.data);
  if (poToken !== undefined) player.po_token = poToken;
  return player;
}
