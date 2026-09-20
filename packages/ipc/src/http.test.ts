import { describe, expect, it } from "vitest";

import { youtubeHeaders } from "./http.ts";

describe("youtubeHeaders", () => {
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

  // youtubei.js identifies its client this way, and passing `init.headers` to
  // the plugin replaces a Request's headers rather than adding to them. Losing
  // these would turn YouTube Music search back into plain YouTube search.
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
