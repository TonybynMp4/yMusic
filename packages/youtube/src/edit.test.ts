import { describe, expect, it } from "vitest";
import type { Innertube } from "youtubei.js";

import {
  coverAction,
  coverOf,
  detailsActions,
  moveAction,
  removeActions,
  removeCoverAction,
  uploadCover,
} from "./edit.ts";

describe("detailsActions", () => {
  it("sends only what changed", () => {
    expect(detailsActions({ title: "Road trip" })).toEqual([
      { action: "ACTION_SET_PLAYLIST_NAME", playlistName: "Road trip" },
    ]);
    expect(detailsActions({})).toEqual([]);
  });

  it("sends an empty description, which clears it", () => {
    expect(detailsActions({ description: "", privacy: "UNLISTED" })).toEqual([
      { action: "ACTION_SET_PLAYLIST_DESCRIPTION", playlistDescription: "" },
      { action: "ACTION_SET_PLAYLIST_PRIVACY", playlistPrivacy: "UNLISTED" },
    ]);
  });
});

describe("removeActions", () => {
  it("names each row by its id within the playlist", () => {
    expect(removeActions([{ videoId: "aaa", itemId: "S1" }])).toEqual([
      { action: "ACTION_REMOVE_VIDEO", setVideoId: "S1", removedVideoId: "aaa" },
    ]);
  });
});

describe("moveAction", () => {
  it("puts a row before another, or last without one", () => {
    expect(moveAction("S1", "S3")).toEqual({
      action: "ACTION_MOVE_VIDEO_BEFORE",
      setVideoId: "S1",
      movedSetVideoIdSuccessor: "S3",
    });
    expect(moveAction("S1", null)).toEqual({ action: "ACTION_MOVE_VIDEO_BEFORE", setVideoId: "S1" });
  });
});

describe("uploadCover", () => {
  it("announces the size, then sends the bytes where it is told", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const youtube = {
      session: {
        http: {
          fetch: async (url: URL, init: RequestInit) => {
            calls.push({ url: url.toString(), init });
            return calls.length === 1
              ? new Response(null, {
                  headers: { "x-goog-upload-url": "https://up.example/1" },
                })
              : Response.json({ encryptedBlobId: "blob" });
          },
        },
      },
    } as unknown as Innertube;
    const image = new Uint8Array([1, 2, 3]);

    expect(await uploadCover(youtube, image)).toBe("blob");
    const [start, upload] = calls;
    expect(new Headers(start!.init.headers).get("x-goog-upload-command")).toBe("start");
    expect(new Headers(start!.init.headers).get("x-goog-upload-header-content-length")).toBe("3");
    expect(upload!.url).toBe("https://up.example/1");
    expect(new Headers(upload!.init.headers).get("x-goog-upload-command")).toBe("upload, finalize");
    expect(upload!.init.body).toBe(image);
  });
});

describe("coverAction", () => {
  it("names the uploaded image as the custom thumbnail", () => {
    expect(coverAction("blob")).toEqual({
      action: "ACTION_SET_CUSTOM_THUMBNAIL",
      addedCustomThumbnail: {
        imageKey: {
          type: "PLAYLIST_IMAGE_TYPE_CUSTOM_THUMBNAIL",
          name: "studio_square_thumbnail",
        },
        playlistScottyEncryptedBlobId: "blob",
      },
    });
  });
});

describe("removeCoverAction", () => {
  it("names the custom cover the way the web player does", () => {
    expect(removeCoverAction()).toEqual({
      action: "ACTION_REMOVE_CUSTOM_THUMBNAIL",
      deletedCustomThumbnail: {
        type: "PLAYLIST_IMAGE_TYPE_CUSTOM_THUMBNAIL",
        name: "studio_square_thumbnail",
      },
    });
  });
});

describe("coverOf", () => {
  it("reads the cover from the header the edit answers with", () => {
    const url = "https://i.ytimg.com/pl_c/PL1/studio_square_thumbnail.jpg";
    const response = {
      newHeader: {
        musicEditablePlaylistDetailHeaderRenderer: {
          header: {
            musicResponsiveHeaderRenderer: {
              thumbnail: {
                musicThumbnailRenderer: {
                  thumbnail: { thumbnails: [{ url, width: 60, height: 60 }] },
                },
              },
            },
          },
        },
      },
    };
    expect(coverOf(response)).toEqual([{ url, width: 60, height: 60 }]);
    expect(coverOf(undefined)).toEqual([]);
  });
});
