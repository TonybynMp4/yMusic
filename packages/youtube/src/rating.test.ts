import { describe, expect, it } from "vitest";

import { ratingFrom } from "./rating.ts";

const next = (likeStatus: string) => ({
  playerOverlays: {
    playerOverlayRenderer: {
      actions: [{ likeButtonRenderer: { likeStatus } }],
    },
  },
});

/** Signed in, as a signed-in `/next` sends it. */
const signedIn = (likeStatus: string) => ({
  playerOverlays: {
    playerOverlayRenderer: {
      videoActionBar: {
        videoActionBarViewModel: {
          buttons: [
            {
              buttonViewModel: {
                segmentedLikeDislikeButtonViewModel: {
                  likeButtonViewModel: {
                    likeButtonViewModel: { likeStatusEntity: { likeStatus } },
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
});

describe("ratingFrom", () => {
  it("reads a signed-in account's like and dislike buttons", () => {
    expect(ratingFrom(signedIn("LIKE"))).toBe("like");
    expect(ratingFrom(signedIn("DISLIKE"))).toBe("dislike");
    expect(ratingFrom(signedIn("INDIFFERENT"))).toBe("none");
  });

  it("reads the signed-out like button's status", () => {
    expect(ratingFrom(next("LIKE"))).toBe("like");
    expect(ratingFrom(next("DISLIKE"))).toBe("dislike");
    expect(ratingFrom(next("INDIFFERENT"))).toBe("none");
  });

  it("is none when the response has no like button", () => {
    expect(ratingFrom({})).toBe("none");
    expect(ratingFrom({ playerOverlays: { playerOverlayRenderer: { actions: [{}] } } })).toBe(
      "none",
    );
  });
});
