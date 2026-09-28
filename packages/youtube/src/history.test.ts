import { describe, expect, it } from "vitest";

import { newCpn, playbackPing, trackingFrom, watchtimePing, type Play } from "./history.ts";

const play: Play = {
  tracking: {
    playbackUrl: "https://s.youtube.com/api/stats/playback?docid=abc&vm=token",
    watchtimeUrl: "https://s.youtube.com/api/stats/watchtime?docid=abc&vm=token",
  },
  client: { name: "WEB_REMIX", version: "1.2" },
  cpn: "cpn0123456789abc",
  startedAt: 1_000_000,
};

describe("trackingFrom", () => {
  it("reads both URLs from a player response", () => {
    expect(
      trackingFrom({
        playbackTracking: {
          videostatsPlaybackUrl: { baseUrl: "https://s.youtube.com/api/stats/playback" },
          videostatsWatchtimeUrl: { baseUrl: "https://s.youtube.com/api/stats/watchtime" },
        },
      }),
    ).toEqual({
      playbackUrl: "https://s.youtube.com/api/stats/playback",
      watchtimeUrl: "https://s.youtube.com/api/stats/watchtime",
    });
  });

  it("is null for an unplayable response, which carries none", () => {
    expect(trackingFrom({})).toBeNull();
  });
});

describe("reports", () => {
  it("sends the start to music.youtube.com, keeping YouTube's own parameters", () => {
    const url = new URL(playbackPing(play, 1_002_500));
    expect(url.host).toBe("music.youtube.com");
    expect(url.pathname).toBe("/api/stats/playback");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      docid: "abc",
      vm: "token",
      ver: "2",
      c: "WEB_REMIX",
      cver: "1.2",
      cpn: "cpn0123456789abc",
      rt: "2.500",
    });
  });

  it("lists each listened stretch in seconds", () => {
    const url = new URL(
      watchtimePing(
        play,
        {
          segments: [
            [0, 10_000],
            [60_000, 65_500],
          ],
          positionMs: 65_500,
          playing: false,
          final: true,
        },
        1_070_000,
      ),
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      st: "0.000,60.000",
      et: "10.000,65.500",
      cmt: "65.500",
      state: "paused",
      rt: "70.000",
      final: "1",
    });
  });

  it("leaves final out until the play is over", () => {
    const url = new URL(
      watchtimePing(play, { segments: [], positionMs: 0, playing: true, final: false }, 1_000_000),
    );
    expect(url.searchParams.has("final")).toBe(false);
    expect(url.searchParams.get("state")).toBe("playing");
  });
});

describe("newCpn", () => {
  it("is sixteen URL-safe characters", () => {
    expect(newCpn()).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});
