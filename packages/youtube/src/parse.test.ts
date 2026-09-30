import { describe, expect, it } from "vitest";

import { yearFrom } from "./parse.ts";

describe("yearFrom", () => {
  it("reads a year on its own or at the end of a subtitle", () => {
    expect(yearFrom("2019")).toBe(2019);
    expect(yearFrom("Album • 1998")).toBe(1998);
  });

  it("takes the last year, so a title with a year in it does not win", () => {
    expect(yearFrom("1999 • Album • 2004")).toBe(2004);
  });

  it("is null for text with no year in it", () => {
    expect(yearFrom("3.2M views")).toBeNull();
    expect(yearFrom("12345")).toBeNull();
    expect(yearFrom(undefined)).toBeNull();
  });
});
