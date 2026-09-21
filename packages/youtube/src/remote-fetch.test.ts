import { describe, expect, it } from "vitest";

import {
  deserializeResponse,
  performRequest,
  serializeRequest,
  serializeResponse,
} from "./remote-fetch.ts";

const text = (buffer: ArrayBuffer | null) => (buffer ? new TextDecoder().decode(buffer) : null);

describe("serializeRequest", () => {
  it("keeps the headers a Request would silently drop", async () => {
    // Origin and Cookie are forbidden on a Request's own headers; the YouTube
    // session needs both to survive the trip to the main thread.
    const request = await serializeRequest("https://www.youtube.com/youtubei/v1/search", {
      method: "POST",
      headers: { Origin: "https://www.youtube.com", Cookie: "a=1, b=2" },
      body: JSON.stringify({ query: "x" }),
    });
    expect(new Headers(request.headers).get("origin")).toBe("https://www.youtube.com");
    expect(new Headers(request.headers).get("cookie")).toBe("a=1, b=2");
    expect(request.method).toBe("POST");
    expect(text(request.body)).toBe('{"query":"x"}');
  });

  it("merges a Request's headers with init's, init winning", async () => {
    const input = new Request("https://www.youtube.com/a", {
      method: "POST",
      headers: { "X-Client": "one", "Content-Type": "application/json" },
      body: "from-request",
    });
    const request = await serializeRequest(input, { headers: { "X-Client": "two" } });
    const headers = new Headers(request.headers);
    expect(headers.get("x-client")).toBe("two");
    expect(headers.get("content-type")).toBe("application/json");
    expect(request.method).toBe("POST");
    expect(text(request.body)).toBe("from-request");
  });

  it("accepts a URL object and defaults to GET with no body", async () => {
    const request = await serializeRequest(new URL("https://www.youtube.com/sw.js"));
    expect(request).toMatchObject({ url: "https://www.youtube.com/sw.js", method: "GET", body: null });
  });
});

describe("responses", () => {
  it("round-trip status, headers, body and url", async () => {
    const original = new Response('{"ok":true}', {
      status: 404,
      statusText: "Not Found",
      headers: { "Content-Type": "application/json" },
    });
    Object.defineProperty(original, "url", { value: "https://www.youtube.com/x" });

    const copy = deserializeResponse(await serializeResponse(original));
    expect(copy.status).toBe(404);
    expect(copy.statusText).toBe("Not Found");
    expect(copy.headers.get("content-type")).toBe("application/json");
    expect(copy.url).toBe("https://www.youtube.com/x");
    expect(await copy.json()).toEqual({ ok: true });
  });

  it("rebuilds a null-body status without throwing", () => {
    const response = deserializeResponse({
      url: "https://www.youtube.com/",
      status: 204,
      statusText: "",
      headers: [],
      body: new ArrayBuffer(0),
    });
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });
});

describe("performRequest", () => {
  it("replays the flattened request through the given fetch", async () => {
    let seen: Request | null = null;
    const fake: typeof fetch = async (input, init) => {
      seen = new Request(input, init);
      return new Response("pong", { status: 200 });
    };
    const response = await performRequest(fake, {
      url: "https://www.youtube.com/ping",
      method: "POST",
      headers: [["x-client", "ytbm"]],
      body: new TextEncoder().encode("ping").buffer,
    });
    expect(seen!.method).toBe("POST");
    expect(seen!.headers.get("x-client")).toBe("ytbm");
    expect(await seen!.text()).toBe("ping");
    expect(text(response.body)).toBe("pong");
  });
});
