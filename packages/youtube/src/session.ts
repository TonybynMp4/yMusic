import type { FetchLike } from "./client.ts";

/**
 * A fetch that reports when YouTube answers a signed-in request as signed out.
 *
 * A saved cookie session goes stale (Google rotates part of it while the
 * browser it came from is in use), and YouTube does not refuse a stale one: it
 * answers as if nobody were signed in, with a sign-in prompt where the library
 * was and the signed-out version of a playlist, music videos where the songs
 * were. Every InnerTube answer says which it was in its `responseContext`, so
 * the body is read on the side, from a clone, and never holds up the caller.
 */
export function watchSession(fetch: FetchLike, onSignedOut: () => void): FetchLike {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (response.ok) {
      void response
        .clone()
        .text()
        .then((body) => {
          if (SIGNED_OUT.test(body)) onSignedOut();
        })
        .catch(() => {});
    }
    return response;
  };
}

const SIGNED_OUT = /"key":\s*"logged_in",\s*"value":\s*"0"/;
