import type { PlaybackEvent } from "@ymusic/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  channel: null as { onmessage: (message: unknown) => void } | null,
  position: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (message: unknown) => void = () => {};
  },
  invoke: vi.fn<(command: string, args?: { channel?: typeof tauri.channel }) => Promise<unknown>>(
    async (command, args) => {
      if (command === "player_subscribe") tauri.channel = args?.channel ?? null;
      if (command === "player_position") return tauri.position();
      return null;
    },
  ),
}));

// `isTauri` is read once, when the module loads.
vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
const { MpvPlaybackEngine } = await import("./player.ts");

let events: PlaybackEvent[];

function push(message: unknown): void {
  tauri.channel!.onmessage(message);
}

function positions(): number[] {
  return events.flatMap((event) => (event.type === "position" ? [event.positionMs] : []));
}

function reply(positionMs: number): Promise<unknown> {
  return Promise.resolve({ positionMs, durationMs: 200_000 });
}

beforeEach(async () => {
  tauri.channel = null;
  tauri.position.mockReset();
  events = [];
  new MpvPlaybackEngine().subscribe((event) => events.push(event));
  // The channel opens behind a dynamic import.
  while (!tauri.channel) await new Promise((resolve) => setTimeout(resolve, 0));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MpvPlaybackEngine position polling", () => {
  it("asks for the position as soon as a song plays", async () => {
    tauri.position.mockReturnValue(reply(1_500));
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    expect(tauri.position).toHaveBeenCalledTimes(1);
    expect(positions()).toEqual([1_500]);
  });

  it("does not ask while loading or paused", async () => {
    push({ type: "status", status: "loading" });
    push({ type: "status", status: "paused" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tauri.position).not.toHaveBeenCalled();
  });

  it("asks again just after the next whole second", async () => {
    tauri.position.mockReturnValueOnce(reply(1_300)).mockReturnValueOnce(reply(2_021));
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    // 1000 - 300 + 20
    await vi.advanceTimersByTimeAsync(719);
    expect(tauri.position).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tauri.position).toHaveBeenCalledTimes(2);
    expect(positions()).toEqual([1_300, 2_021]);
  });

  it.each(["paused", "loading", "ended", "idle"])("stops on a %s status", async (status) => {
    tauri.position.mockImplementation(() => reply(1_000));
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    push({ type: "status", status });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tauri.position).toHaveBeenCalledTimes(1);
  });

  it("drops a reply that lands after a pause", async () => {
    let answer!: (value: unknown) => void;
    tauri.position.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    push({ type: "status", status: "paused" });
    answer({ positionMs: 4_000, durationMs: 200_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(positions()).toEqual([]);
    expect(tauri.position).toHaveBeenCalledTimes(1);
  });

  it("stops when the stream fails", async () => {
    tauri.position.mockImplementation(() => reply(1_000));
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    push({ type: "error", trackId: null, message: "playback failed" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tauri.position).toHaveBeenCalledTimes(1);
    expect(events.at(-1)?.type).toBe("error");
  });

  it("stops when nothing is loaded, until the next song plays", async () => {
    tauri.position.mockReturnValueOnce(Promise.resolve(null)).mockReturnValue(reply(0));
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tauri.position).toHaveBeenCalledTimes(1);
    expect(positions()).toEqual([]);

    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    expect(tauri.position).toHaveBeenCalledTimes(2);
    expect(positions()).toEqual([0]);
  });

  it("passes pushed positions through while paused", async () => {
    push({ type: "status", status: "paused" });
    push({ type: "position", positionMs: 42_000, durationMs: 200_000 });
    expect(positions()).toEqual([42_000]);
    expect(tauri.position).not.toHaveBeenCalled();
  });
});
