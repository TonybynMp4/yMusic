import type { PlaylistPrivacy, Thumbnail } from "@ymusic/core";
import type { Innertube } from "youtubei.js";

import { toThumbnails, type RawThumbnail } from "./thumbnails.ts";

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

type EditAction = Record<string, unknown>;

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
): Promise<unknown> {
  if (actions.length === 0) return undefined;
  const response = await youtube.actions.execute("/browse/edit_playlist", {
    playlistId,
    actions: [...actions],
    client: "YTMUSIC",
  });
  const status = (response.data as { status?: unknown } | undefined)?.status;
  if (status !== "STATUS_SUCCEEDED") throw new Error("YouTube did not change the playlist");
  return response.data;
}

export async function deletePlaylist(youtube: Innertube, playlistId: string): Promise<void> {
  await youtube.actions.execute("/playlist/delete", { playlistId, client: "YTMUSIC" });
}

/**
 * Where the web player sends a new cover. A Google resumable upload: one
 * request announces the size and is answered with the URL to send the bytes
 * to, the second sends them all and is answered with the id of the stored
 * image. youtubei.js signs it as it signs InnerTube calls, since this is the
 * same session.
 */
const COVER_UPLOAD_URL =
  "https://music.youtube.com/playlist_image_upload/playlist_custom_thumbnail";

export async function uploadCover(
  youtube: Innertube,
  image: Uint8Array<ArrayBuffer>,
): Promise<string> {
  // A URL rather than a string: youtubei.js joins a string onto InnerTube's own address.
  const start = await youtube.session.http.fetch(new URL(COVER_UPLOAD_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(image.byteLength),
      "X-Goog-Upload-Protocol": "resumable",
    },
  });
  const target = start.headers.get("x-goog-upload-url");
  if (!target) throw new Error("YouTube did not accept the cover");
  const upload = await youtube.session.http.fetch(new URL(target), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
    },
    body: image,
  });
  const { encryptedBlobId } = (await upload.json()) as {
    encryptedBlobId?: unknown;
  };
  if (typeof encryptedBlobId !== "string") throw new Error("YouTube did not accept the cover");
  return encryptedBlobId;
}

/** Makes the uploaded image `blobId` the playlist's cover. */
export function coverAction(blobId: string): EditAction {
  return {
    action: "ACTION_SET_CUSTOM_THUMBNAIL",
    addedCustomThumbnail: {
      imageKey: {
        type: "PLAYLIST_IMAGE_TYPE_CUSTOM_THUMBNAIL",
        name: "studio_square_thumbnail",
      },
      playlistScottyEncryptedBlobId: blobId,
    },
  };
}

/** The cover in the header an edit answers with: after `coverAction`, the new one. */
export function coverOf(response: unknown): Thumbnail[] {
  const header = (response as EditResponse | undefined)?.newHeader
    ?.musicEditablePlaylistDetailHeaderRenderer?.header?.musicResponsiveHeaderRenderer;
  return toThumbnails(header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
}

interface EditResponse {
  newHeader?: {
    musicEditablePlaylistDetailHeaderRenderer?: {
      header?: {
        musicResponsiveHeaderRenderer?: {
          thumbnail?: {
            musicThumbnailRenderer?: {
              thumbnail?: { thumbnails?: RawThumbnail[] };
            };
          };
        };
      };
    };
  };
}
