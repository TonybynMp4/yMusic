// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { VideoId } from "@ymusic/core";

import type { engine as realEngine } from "./engine.ts";
import { RatingStore, useRatings } from "./useRatings.ts";

type Engine = typeof realEngine;
const engine = vi.hoisted(() => ({ rate: vi.fn<Engine["rate"]>() }));
vi.mock("./engine.ts", () => ({ engine }));

const song = "dQw4w9WgXcQ" as VideoId;

function render(initial: string | null) {
  return renderHook(({ account }: { account: string | null }) => useRatings(account), {
    initialProps: { account: initial },
  });
}

beforeEach(() => {
  localStorage.clear();
  engine.rate.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("useRatings", () => {
  it("gives ratingOf a new identity only when a rating changes", () => {
    const { result } = render("a");
    const first = result.current.ratingOf;
    act(() => result.current.learn(song, "none"));
    expect(result.current.ratingOf).toBe(first);
    act(() => result.current.learn(song, "dislike"));
    expect(result.current.ratingOf).not.toBe(first);
    expect(result.current.ratingOf(song)).toBe("dislike");
  });

  it("drops an answer for an account that was switched away from", () => {
    const { result, rerender } = render("a");
    const lateLearn = result.current.learn;
    rerender({ account: "b" });
    act(() => lateLearn(song, "dislike"));
    expect(result.current.ratingOf(song)).toBe("none");
    rerender({ account: "a" });
    expect(result.current.ratingOf(song)).toBe("none");
  });

  it("keeps an answer that comes before React subscribes", () => {
    const store = new RatingStore("a");
    store.learn(song, "dislike");
    expect(store.getRatingOf()(song)).toBe("dislike");
  });

  it("puts a rating back when YouTube refuses it", async () => {
    engine.rate.mockRejectedValue(new Error("offline"));
    const { result } = render("a");
    await act(async () => {
      await expect(result.current.rate(song, "like")).rejects.toThrow("offline");
    });
    expect(result.current.ratingOf(song)).toBe("none");
  });

  it("knows nothing while signed out", () => {
    const { result } = render(null);
    expect(result.current.ratingOf(song)).toBeNull();
  });
});
