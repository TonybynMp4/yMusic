import { describe, expect, it, vi } from "vitest";

import { watchSession } from "./session.ts";

function answering(loggedIn: string): typeof fetch {
  const body = JSON.stringify({
    responseContext: {
      serviceTrackingParams: [
        { service: "GFEEDBACK", params: [{ key: "logged_in", value: loggedIn }] },
      ],
    },
  });
  return async () => new Response(body, { headers: { "content-type": "application/json" } });
}

describe("watchSession", () => {
  it("reports an answer YouTube gave as if nobody were signed in", async () => {
    const onSignedOut = vi.fn<() => void>();
    const response = await watchSession(answering("0"), onSignedOut)("https://music.youtube.com");
    // The caller still gets the whole body: the check reads a clone.
    expect(await response.json()).toHaveProperty("responseContext");
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
  });

  it("stays quiet while the session holds", async () => {
    const onSignedOut = vi.fn<() => void>();
    await (await watchSession(answering("1"), onSignedOut)("https://music.youtube.com")).text();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
