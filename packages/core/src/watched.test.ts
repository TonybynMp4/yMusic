import { describe, expect, it } from "vitest";

import { Listened } from "./watched.ts";

describe("Listened", () => {
  it("joins steady updates into one stretch", () => {
    const listened = new Listened();
    for (const ms of [0, 500, 1000, 1500, 2000]) listened.observe(ms);
    expect(listened.take()).toEqual([[0, 2000]]);
  });

  it("starts a new stretch after a seek", () => {
    const listened = new Listened();
    for (const ms of [0, 1000, 2000, 60_000, 61_000]) listened.observe(ms);
    expect(listened.take()).toEqual([
      [0, 2000],
      [60_000, 61_000],
    ]);
  });

  it("starts a new stretch after seeking back", () => {
    const listened = new Listened();
    for (const ms of [10_000, 11_000, 3000, 4000]) listened.observe(ms);
    expect(listened.take()).toEqual([
      [10_000, 11_000],
      [3000, 4000],
    ]);
  });

  it("does not bridge a pause", () => {
    const listened = new Listened();
    listened.observe(0);
    listened.observe(1000);
    listened.pause();
    listened.observe(1000);
    listened.observe(2000);
    expect(listened.take()).toEqual([
      [0, 1000],
      [1000, 2000],
    ]);
  });

  it("reports each stretch once, continuing one still growing", () => {
    const listened = new Listened();
    listened.observe(0);
    listened.observe(1000);
    expect(listened.take()).toEqual([[0, 1000]]);
    expect(listened.take()).toEqual([]);
    listened.observe(2000);
    expect(listened.take()).toEqual([[1000, 2000]]);
  });
});
