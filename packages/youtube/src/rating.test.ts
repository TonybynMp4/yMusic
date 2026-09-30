import { describe, expect, it } from "vitest";

import { ratingFrom } from "./rating.ts";

const next = (likeStatus: string) => ({
  playerOverlays: {
    playerOverlayRenderer: {
      actions: [{ likeButtonRenderer: { likeStatus } }],
    },
  },
});

describe("ratingFrom", () => {
  it("reads the like button's status", () => {
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
