import { describe, expect, it } from "vitest";

import { centredCrop, isCustomCover } from "./cover.ts";

describe("centredCrop", () => {
  it("takes the largest square in the middle", () => {
    expect(centredCrop(1000, 600)).toEqual({ x: 200, y: 0, size: 600 });
  });
});

describe("isCustomCover", () => {
  it("tells an uploaded cover from the one YouTube makes", () => {
    const custom = "https://i.ytimg.com/pl_c/PLx/studio_square_thumbnail.jpg?sqp=1";
    expect(isCustomCover([{ url: custom }])).toBe(true);
    expect(isCustomCover([{ url: "https://yt3.googleusercontent.com/abc=s576" }])).toBe(false);
    expect(isCustomCover([])).toBe(false);
  });
});
