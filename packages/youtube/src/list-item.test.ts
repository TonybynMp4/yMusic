import { describe, expect, it } from "vitest";
import { Parser } from "youtubei.js";

import { keepUnavailableRows } from "./list-item.ts";
import { toTrack, type RawSong } from "./parse.ts";

/**
 * Album rows trimmed from a signed-out `browse` of Highway 61 Revisited
 * (2026-11-22). "Like a Rolling Stone" was Premium-only there: greyed out, its
 * title opening the Premium upsell, its video id only in `playlistItemData`.
 */
function row(videoId: string, title: string, duration: string, premium: boolean) {
  const endpoint = premium
    ? {
        showDialogCommand: {
          panelLoadingStrategy: {
            requestTemplate: { panelId: "PApremium_upsell", params: "igkCCA0%3D" },
          },
        },
      }
    : {
        watchEndpoint: {
          videoId,
          watchEndpointMusicSupportedConfigs: {
            watchEndpointMusicConfig: { musicVideoType: "MUSIC_VIDEO_TYPE_ATV" },
          },
        },
      };
  return {
    musicResponsiveListItemRenderer: {
      flexColumns: [
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: title, navigationEndpoint: endpoint }] },
          },
        },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: premium ? {} : { runs: [{ text: "2.2M plays" }] },
          },
        },
      ],
      fixedColumns: [
        { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: duration }] } } },
      ],
      playlistItemData: { videoId },
      ...(premium
        ? { musicItemRendererDisplayPolicy: "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT" }
        : {}),
    },
  };
}

describe("a greyed-out row", () => {
  keepUnavailableRows();

  it("keeps its id and duration, and says it needs Premium", () => {
    const parsed = Parser.parseItem(row("syNLBJ_Lq9E", "Like a Rolling Stone", "6:10", true));
    const track = toTrack(parsed as unknown as RawSong);
    expect(track).toMatchObject({
      id: "yt:syNLBJ_Lq9E",
      title: "Like a Rolling Stone",
      durationMs: 370_000,
      availability: "premium",
    });
  });

  it("leaves a playable row available", () => {
    const parsed = Parser.parseItem(row("4mQ3ZqnhTCA", "Tombstone Blues", "5:57", false));
    expect(toTrack(parsed as unknown as RawSong)?.availability).toBe("available");
  });
});
