import { describe, expect, it } from "vitest";

import {
  fetchSignatureTimestamp,
  newCpn,
  playbackPing,
  playerIdFrom,
  signatureTimestampFrom,
  trackingFrom,
  watchtimePing,
  type Play,
} from "./history.ts";

const play: Play = {
  tracking: {
    playbackUrl: "https://s.youtube.com/api/stats/playback?docid=abc&vm=token",
    watchtimeUrl: "https://s.youtube.com/api/stats/watchtime?docid=abc&vm=token",
  },
  client: { name: "WEB_REMIX", version: "1.2" },
  cpn: "cpn0123456789abc",
  startedAt: 1_000_000,
  playlistId: null,
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
  it("name the playlist a song plays from, so the account's queue stays that playlist", () => {
    const from: Play = { ...play, playlistId: "PLabc" };
    expect(new URL(playbackPing(from, 1_000_000)).searchParams.get("list")).toBe("PLabc");
    const watch = { segments: [], positionMs: 0, playing: true, final: false };
    expect(new URL(watchtimePing(from, watch, 1_000_000)).searchParams.get("list")).toBe("PLabc");
    expect(new URL(playbackPing(play, 1_000_000)).searchParams.has("list")).toBe(false);
  });

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

describe("fetchSignatureTimestamp", () => {
  it("finds the player script through iframe_api and reads its timestamp", async () => {
    const asked: string[] = [];
    const fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body = url.endsWith("/iframe_api")
        ? String.raw`var scriptUrl = 'https:\/\/www.youtube.com\/s\/player\/6c5cb4f4\/www-widgetapi.vflset\/www-widgetapi.js';`
        : "var a={signatureTimestamp:20732,foo:1};";
      return new Response(body);
    };
    expect(await fetchSignatureTimestamp(fetch)).toBe(20732);
    expect(asked[1]).toBe(
      "https://www.youtube.com/s/player/6c5cb4f4/player_es6.vflset/en_US/base.js",
    );
  });

  it("fails rather than guessing when the script has no timestamp", async () => {
    const fetch = async (input: RequestInfo | URL) =>
      new Response(String(input).endsWith("/iframe_api") ? String.raw`player\/abc\/` : "nothing");
    await expect(fetchSignatureTimestamp(fetch)).rejects.toThrow("no signature timestamp");
  });

  it("stops at iframe_api when it cannot name the player script", async () => {
    const asked: string[] = [];
    const answer =
      (body: string, status = 200) =>
      async (input: RequestInfo | URL) => {
        asked.push(String(input));
        return new Response(body, { status });
      };
    await expect(fetchSignatureTimestamp(answer("", 503))).rejects.toThrow("503");
    await expect(fetchSignatureTimestamp(answer("var x = 1;"))).rejects.toThrow("id");
    expect(asked).toEqual([
      "https://www.youtube.com/iframe_api",
      "https://www.youtube.com/iframe_api",
    ]);
  });

  it("ignores numbers that are not a five-digit timestamp", () => {
    expect(signatureTimestampFrom("{sts:123,x:1}")).toBeNull();
    expect(signatureTimestampFrom("var b={sts:1},a={signatureTimestamp:20732}")).toBe(20732);
  });

  it("accepts the short sts spelling and rejects ids it cannot find", () => {
    expect(signatureTimestampFrom("{sts: 19876}")).toBe(19876);
    expect(playerIdFrom("no player here")).toBeNull();
  });
});
