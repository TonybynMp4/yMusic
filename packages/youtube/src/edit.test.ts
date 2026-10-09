import { describe, expect, it } from "vitest";

import { detailsActions, moveAction, removeActions } from "./edit.ts";

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
