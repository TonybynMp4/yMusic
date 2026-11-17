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
const { MpvPlaybackEngine, HIDDEN_POLL_MS } = await import("./player.ts");

let engine: InstanceType<typeof MpvPlaybackEngine>;
let events: PlaybackEvent[];
let hidden: boolean;
let hiddenListeners: Set<() => void>;

function setHidden(next: boolean): void {
  hidden = next;
  for (const listener of hiddenListeners) listener();
}

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
  hidden = false;
  hiddenListeners = new Set();
  engine = new MpvPlaybackEngine({
    get: () => hidden,
    subscribe(listener) {
      hiddenListeners.add(listener);
      return () => void hiddenListeners.delete(listener);
    },
  });
  engine.subscribe((event) => events.push(event));
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

  it("drops a reply asked for before a seek", async () => {
    let answer!: (value: unknown) => void;
    tauri.position
      .mockReturnValueOnce(reply(10_000))
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockReturnValue(reply(60_100));
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_020);
    await engine.seek(60_000);
    answer({ positionMs: 11_020, durationMs: 200_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(positions()).toEqual([10_000]);
  });

  it("waits for playback to restart before asking again after a seek", async () => {
    tauri.position.mockReturnValueOnce(reply(10_000)).mockReturnValue(reply(60_100));
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    await engine.seek(60_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tauri.position).toHaveBeenCalledTimes(1);

    push({ type: "position", positionMs: 60_000, durationMs: 200_000 });
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    expect(positions()).toEqual([10_000, 60_000, 60_100]);
  });

  it("asks again when a seek fails", async () => {
    tauri.position.mockReturnValueOnce(reply(10_000)).mockReturnValue(reply(11_000));
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("seek failed"));
    await expect(engine.seek(60_000)).rejects.toThrow("seek failed");
    await vi.advanceTimersByTimeAsync(0);
    expect(positions()).toEqual([10_000, 11_000]);
  });
});

describe("MpvPlaybackEngine while the window is hidden", () => {
  it("asks every ten seconds", async () => {
    tauri.position
      .mockReturnValueOnce(reply(1_300))
      .mockReturnValueOnce(reply(2_021))
      .mockReturnValue(reply(12_030));
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    setHidden(true);
    // The poll already due still fires on the second.
    await vi.advanceTimersByTimeAsync(720);
    expect(tauri.position).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(HIDDEN_POLL_MS - 1);
    expect(tauri.position).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tauri.position).toHaveBeenCalledTimes(3);
    expect(positions()).toEqual([1_300, 2_021, 12_030]);
  });

  it("asks at once when the window is shown, then every second again", async () => {
    tauri.position
      .mockReturnValueOnce(reply(1_000))
      .mockReturnValueOnce(reply(5_300))
      .mockReturnValue(reply(6_020));
    setHidden(true);
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(tauri.position).toHaveBeenCalledTimes(1);

    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(positions()).toEqual([1_000, 5_300]);
    await vi.advanceTimersByTimeAsync(720);
    expect(positions()).toEqual([1_000, 5_300, 6_020]);
  });

  it("asks once when shown while paused", async () => {
    tauri.position.mockReturnValueOnce(reply(1_000)).mockReturnValue(reply(8_400));
    setHidden(true);
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    push({ type: "status", status: "paused" });

    setHidden(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tauri.position).toHaveBeenCalledTimes(2);
    expect(positions()).toEqual([1_000, 8_400]);
  });

  it("does not ask when shown with nothing loaded, or while a song loads", async () => {
    setHidden(true);
    setHidden(false);
    setHidden(true);
    push({ type: "status", status: "loading" });
    setHidden(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tauri.position).not.toHaveBeenCalled();
  });

  it("does not ask when shown in the middle of a seek", async () => {
    tauri.position.mockReturnValue(reply(10_000));
    setHidden(true);
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(0);
    await engine.seek(60_000);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tauri.position).toHaveBeenCalledTimes(1);
  });

  it("syncs the position on request, and keeps the slow poll going", async () => {
    tauri.position.mockReturnValueOnce(reply(1_000)).mockReturnValue(reply(7_500));
    setHidden(true);
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(6_000);

    await engine.syncPosition();
    expect(positions()).toEqual([1_000, 7_500]);
    await vi.advanceTimersByTimeAsync(HIDDEN_POLL_MS - 1);
    expect(tauri.position).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tauri.position).toHaveBeenCalledTimes(3);
  });

  it("answers overlapping syncs with one question, and both see the fresh position", async () => {
    tauri.position.mockReturnValueOnce(reply(1_000)).mockReturnValue(reply(7_500));
    setHidden(true);
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(6_000);

    const seen: number[][] = [];
    const first = engine.syncPosition().then(() => seen.push(positions()));
    const second = engine.syncPosition().then(() => seen.push(positions()));
    await Promise.all([first, second]);

    expect(tauri.position).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([
      [1_000, 7_500],
      [1_000, 7_500],
    ]);
  });

  it("asks again when a status drops the reply to a sync", async () => {
    tauri.position.mockReturnValueOnce(reply(1_000));
    setHidden(true);
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(6_000);

    let answer!: (position: { positionMs: number; durationMs: number }) => void;
    tauri.position
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockReturnValue(reply(7_500));
    const synced = engine.syncPosition();
    push({ type: "status", status: "playing" });
    answer({ positionMs: 7_000, durationMs: 200_000 });
    await synced;

    expect(positions()).toEqual([1_000, 7_500]);
  });

  it("keeps polling after a question that failed", async () => {
    tauri.position.mockReturnValueOnce(reply(1_000));
    setHidden(true);
    push({ type: "status", status: "playing" });
    await vi.advanceTimersByTimeAsync(6_000);

    tauri.position.mockRejectedValueOnce(new Error("no reply")).mockReturnValue(reply(17_000));
    await engine.syncPosition();
    expect(positions()).toEqual([1_000]);

    await vi.advanceTimersByTimeAsync(HIDDEN_POLL_MS);
    expect(positions()).toEqual([1_000, 17_000]);
  });
});
