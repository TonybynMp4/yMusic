import { describe, expect, it } from "vitest";

import { centredCrop, isCustomCover, moveCrop, resizeCrop } from "./cover.ts";

describe("centredCrop", () => {
  it("takes the largest square in the middle", () => {
    expect(centredCrop(1000, 600)).toEqual({ x: 200, y: 0, size: 600 });
  });
});

describe("moveCrop", () => {
  it("stops at the image's edges", () => {
    const crop = { x: 200, y: 0, size: 600 };
    expect(moveCrop(crop, 50, 50, 1000, 600)).toEqual({ x: 250, y: 0, size: 600 });
    expect(moveCrop(crop, 900, 0, 1000, 600)).toEqual({ x: 400, y: 0, size: 600 });
    expect(moveCrop(crop, -900, 0, 1000, 600)).toEqual({ x: 0, y: 0, size: 600 });
  });
});

describe("resizeCrop", () => {
  const crop = { x: 200, y: 100, size: 400 };

  it("keeps the opposite corner where it was", () => {
    expect(resizeCrop(crop, "se", 20, 0, 1000, 1000)).toEqual({ x: 200, y: 100, size: 420 });
    expect(resizeCrop(crop, "nw", -20, -10, 1000, 1000)).toEqual({ x: 180, y: 80, size: 420 });
    expect(resizeCrop(crop, "ne", 0, -30, 1000, 1000)).toEqual({ x: 200, y: 70, size: 430 });
    expect(resizeCrop(crop, "sw", -10, 0, 1000, 1000)).toEqual({ x: 190, y: 100, size: 410 });
  });

  it("stays inside the image and no smaller than YouTube takes", () => {
    expect(resizeCrop(crop, "nw", -500, -500, 1000, 1000)).toEqual({ x: 100, y: 0, size: 500 });
    expect(resizeCrop(crop, "se", -300, -300, 1000, 1000)).toEqual({ x: 200, y: 100, size: 360 });
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
