import { describe, expect, it } from "vitest";

import { centredCrop, isCustomCover, moveCrop, zoomCrop } from "./cover.ts";

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

describe("zoomCrop", () => {
  const crop = { x: 300, y: 100, size: 400 };

  it("keeps the centre where it was", () => {
    expect(zoomCrop(crop, 1.5, 1000, 1000)).toEqual({ x: 200, y: 0, size: 600 });
  });

  it("stays between YouTube's smallest and the image, inside the image", () => {
    expect(zoomCrop(crop, 0.1, 1000, 1000)).toEqual({ x: 320, y: 120, size: 360 });
    expect(zoomCrop(crop, 10, 1000, 600)).toEqual({ x: 200, y: 0, size: 600 });
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
