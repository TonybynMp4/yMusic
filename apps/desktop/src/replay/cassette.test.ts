import { describe, expect, it } from "vitest";

import {
  commandKey,
  decodeBody,
  encodeBody,
  httpKey,
  keptResponseHeaders,
  scrubCookie,
  Timeline,
  type Entry,
} from "./cassette.ts";

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("httpKey", () => {
  it("ignores the client context and volatile query parameters", () => {
    const one = httpKey(
      "post",
      "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false&key=abc",
      json({ context: { client: { visitorData: "a" } }, browseId: "VLPL1" }),
    );
    const two = httpKey(
      "POST",
      "https://music.youtube.com/youtubei/v1/browse?key=xyz",
      json({ browseId: "VLPL1", context: { client: { visitorData: "b" } } }),
    );
    expect(one).toBe(two);
    expect(one).toBe('POST music.youtube.com/youtubei/v1/browse {"browseId":"VLPL1"}');
  });

  it("tells different pages and continuations apart", () => {
    const url = "https://music.youtube.com/youtubei/v1/browse";
    expect(httpKey("POST", url, json({ browseId: "a" }))).not.toBe(
      httpKey("POST", url, json({ browseId: "b" })),
    );
    expect(httpKey("POST", url, json({ continuation: "x" }))).not.toBe(
      httpKey("POST", url, json({ continuation: "y" })),
    );
  });

  it("keeps the query parameters that pick a resource", () => {
    expect(httpKey("GET", "https://www.youtube.com/iframe_api?v=2&t=99", new Uint8Array())).toBe(
      "GET www.youtube.com/iframe_api?v=2",
    );
  });

  it("matches a body that is not JSON on its length", () => {
    expect(httpKey("POST", "https://www.youtube.com/x", new Uint8Array([1, 2, 3]))).toBe(
      "POST www.youtube.com/x <3 bytes>",
    );
  });
});

describe("commandKey", () => {
  it("drops the channel id, which differs every run", () => {
    expect(commandKey("player_subscribe", { channel: "__CHANNEL__:4012" })).toBe(
      'player_subscribe {"channel":"__CHANNEL__"}',
    );
  });

  it("is the bare name for a command with no arguments", () => {
    expect(commandKey("settings_get", undefined)).toBe("settings_get");
    expect(commandKey("settings_get", {})).toBe("settings_get");
  });
});

describe("scrubbing", () => {
  it("keeps every cookie name and no value", () => {
    expect(scrubCookie("SID=secret; __Secure-3PSID=also; HSID=x")).toBe(
      "SID=replay; __Secure-3PSID=replay; HSID=replay",
    );
  });

  it("drops cookies and headers that no longer describe the body", () => {
    expect(
      keptResponseHeaders([
        ["Set-Cookie", "VISITOR_INFO1_LIVE=abc"],
        ["content-encoding", "br"],
        ["content-type", "application/json"],
      ]),
    ).toEqual([["content-type", "application/json"]]);
  });
});

describe("bodies", () => {
  it("round-trips text and binary", () => {
    for (const body of [json({ a: "é" }), new Uint8Array([0, 255, 128, 7])]) {
      expect(decodeBody(encodeBody(body))).toEqual(body);
    }
    expect(encodeBody(new Uint8Array([0xff])).encoding).toBe("base64");
  });
});

describe("Timeline", () => {
  const entry = (seq: number, key: string, result: unknown): Entry => ({
    seq,
    cmd: "cmd",
    key,
    result,
  });

  it("shows a page as it was until a later recorded call has been replayed", () => {
    const timeline = new Timeline([
      entry(1, "library", "before"),
      entry(2, "edit", "ok"),
      entry(3, "library", "after"),
    ]);
    expect(timeline.find("library")?.result).toBe("before");
    expect(timeline.find("library")?.result).toBe("before");
    expect(timeline.find("edit")?.result).toBe("ok");
    expect(timeline.find("library")?.result).toBe("after");
  });

  it("starts at the first recording of a key", () => {
    const timeline = new Timeline([entry(9, "a", "nine"), entry(5, "a", "five")]);
    expect(timeline.find("a")?.result).toBe("five");
  });

  it("follows the recording when the same key comes back", () => {
    const timeline = new Timeline([
      entry(1, "home", "first"),
      entry(2, "search", "results"),
      entry(3, "home", "second"),
    ]);
    expect(timeline.find("home")?.result).toBe("first");
    expect(timeline.find("search")?.result).toBe("results");
    expect(timeline.find("home")?.result).toBe("second");
    expect(timeline.find("home")?.result).toBe("second");
    expect(timeline.find("missing")).toBeUndefined();
  });
});
