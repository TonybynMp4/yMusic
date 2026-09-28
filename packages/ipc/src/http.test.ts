import { describe, expect, it } from "vitest";

import { decodeFrame, encodeFrame, youtubeHeaders } from "./http.ts";

describe("youtubeHeaders", () => {
  it("sends no origin when the caller asks for none with an empty one", () => {
    const headers = youtubeHeaders("https://jnn-pa.googleapis.com/$rpc/x", {
      headers: { Origin: "" },
    });

    expect(headers.get("Origin")).toBe("");
    expect(headers.has("Referer")).toBe(false);
  });

  it("replaces the webview's own origin, which YouTube answers with 403", () => {
    const headers = youtubeHeaders("https://www.youtube.com/youtubei/v1/search", {
      headers: { Origin: "http://tauri.localhost" },
    });

    expect(headers.get("Origin")).toBe("https://www.youtube.com");
    expect(headers.get("Referer")).toBe("https://www.youtube.com/");
  });

  it("sets an origin even when the caller passed no headers at all", () => {
    const headers = youtubeHeaders("https://www.youtube.com/youtubei/v1/config");

    expect(headers.get("Origin")).toBe("https://www.youtube.com");
    expect(headers.get("Referer")).toBe("https://www.youtube.com/");
  });

  // youtubei.js identifies its client this way. Losing these would turn
  // YouTube Music search back into plain YouTube search.
  it("keeps the client headers a Request carries", () => {
    const request = new Request("https://www.youtube.com/youtubei/v1/search", {
      method: "POST",
      headers: { "X-Youtube-Client-Name": "67", "Content-Type": "application/json" },
      body: "{}",
    });

    const headers = youtubeHeaders(request);

    expect(headers.get("X-Youtube-Client-Name")).toBe("67");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Origin")).toBe("https://www.youtube.com");
  });

  it("lets init override a Request's headers, as fetch itself does", () => {
    const request = new Request("https://www.youtube.com/youtubei/v1/search", {
      headers: { "X-Goog-Visitor-Id": "from-request" },
    });

    const headers = youtubeHeaders(request, {
      headers: { "X-Goog-Visitor-Id": "from-init" },
    });

    expect(headers.get("X-Goog-Visitor-Id")).toBe("from-init");
  });
});

describe("frames", () => {
  it("carry a head and a binary body across unchanged", () => {
    const body = new Uint8Array([0, 255, 10, 13]);
    const frame = encodeFrame({ url: "https://www.youtube.com/", note: "é" }, body);

    const decoded = decodeFrame<{ url: string; note: string }>(frame);

    expect(decoded.head).toEqual({ url: "https://www.youtube.com/", note: "é" });
    expect([...decoded.body]).toEqual([0, 255, 10, 13]);
  });

  it("read from a view into a larger buffer", () => {
    const frame = encodeFrame({ status: 200 }, new Uint8Array([7]));
    const padded = new Uint8Array(frame.length + 3);
    padded.set(frame, 3);

    const decoded = decodeFrame<{ status: number }>(padded.subarray(3));

    expect(decoded.head.status).toBe(200);
    expect([...decoded.body]).toEqual([7]);
  });
});
