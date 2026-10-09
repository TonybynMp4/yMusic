import type { PlaylistPrivacy } from "@ymusic/core";
import type { Innertube } from "youtubei.js";

/**
 * Changes to your own playlists, sent as YouTube Music's web player sends
 * them: every edit is a list of actions to `browse/edit_playlist`, and
 * deleting is `playlist/delete`. Both go through the YouTube Music client,
 * as rating does: youtubei.js's playlist manager sends the plain web client,
 * and a session cookie on a client it did not come from is the mismatch
 * YouTube flags.
 */

/** What the edit form changes. Anything left out stays as it is. */
export interface PlaylistDetails {
  title?: string;
  description?: string;
  privacy?: PlaylistPrivacy;
}

/** A row to remove: the song, and its id within the playlist. */
export interface PlaylistItem {
  videoId: string;
  itemId: string;
}

type EditAction = Record<string, string>;

export function detailsActions(details: PlaylistDetails): EditAction[] {
  const actions: EditAction[] = [];
  if (details.title !== undefined) {
    actions.push({ action: "ACTION_SET_PLAYLIST_NAME", playlistName: details.title });
  }
  if (details.description !== undefined) {
    actions.push({
      action: "ACTION_SET_PLAYLIST_DESCRIPTION",
      playlistDescription: details.description,
    });
  }
  if (details.privacy !== undefined) {
    actions.push({ action: "ACTION_SET_PLAYLIST_PRIVACY", playlistPrivacy: details.privacy });
  }
  return actions;
}

export function removeActions(items: readonly PlaylistItem[]): EditAction[] {
  return items.map((item) => ({
    action: "ACTION_REMOVE_VIDEO",
    setVideoId: item.itemId,
    removedVideoId: item.videoId,
  }));
}

/**
 * Puts the row `itemId` right before `beforeItemId`, or last when that is
 * null. YouTube Music's own drag sends the row that ends up after it.
 */
export function moveAction(itemId: string, beforeItemId: string | null): EditAction {
  return beforeItemId === null
    ? { action: "ACTION_MOVE_VIDEO_BEFORE", setVideoId: itemId }
    : {
        action: "ACTION_MOVE_VIDEO_BEFORE",
        setVideoId: itemId,
        movedSetVideoIdSuccessor: beforeItemId,
      };
}

export async function editPlaylist(
  youtube: Innertube,
  playlistId: string,
  actions: readonly EditAction[],
): Promise<void> {
  if (actions.length === 0) return;
  const response = await youtube.actions.execute("/browse/edit_playlist", {
    playlistId,
    actions: [...actions],
    client: "YTMUSIC",
  });
  const status = (response.data as { status?: unknown } | undefined)?.status;
  if (status !== "STATUS_SUCCEEDED") throw new Error("YouTube did not change the playlist");
}

export async function deletePlaylist(youtube: Innertube, playlistId: string): Promise<void> {
  await youtube.actions.execute("/playlist/delete", { playlistId, client: "YTMUSIC" });
}
