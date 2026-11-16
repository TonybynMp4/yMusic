import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  channels: [] as { onmessage: (message: unknown) => void }[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (message: unknown) => void = () => {};
  },
  invoke: vi.fn<
    (command: string, args?: { channel?: (typeof tauri.channels)[number] }) => Promise<unknown>
  >(async (command, args) => {
    if (command === "window_subscribe" && args?.channel) tauri.channels.push(args.channel);
    return null;
  }),
}));

// `isTauri` is read once, when the module loads.
vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
const { createWindowHidden } = await import("./window.ts");

async function opened(): Promise<(typeof tauri.channels)[number]> {
  // The channel opens behind a dynamic import.
  while (tauri.channels.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  return tauri.channels[0]!;
}

beforeEach(() => {
  tauri.channels.length = 0;
});

describe("windowHidden", () => {
  it("is shown until Rust says otherwise", async () => {
    const store = createWindowHidden();
    const listener = vi.fn<() => void>();
    store.subscribe(listener);
    const channel = await opened();
    expect(store.get()).toBe(false);

    channel.onmessage("hidden");
    expect(store.get()).toBe(true);
    channel.onmessage("shown");
    expect(store.get()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("only tells listeners about a change", async () => {
    const store = createWindowHidden();
    const listener = vi.fn<() => void>();
    store.subscribe(listener);
    const channel = await opened();
    channel.onmessage("shown");
    channel.onmessage("hidden");
    channel.onmessage("hidden");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("opens one channel however many subscribe", async () => {
    const store = createWindowHidden();
    const first = vi.fn<() => void>();
    const second = vi.fn<() => void>();
    const unsubscribe = store.subscribe(first);
    store.subscribe(second);
    const channel = await opened();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tauri.channels).toHaveLength(1);

    unsubscribe();
    channel.onmessage("hidden");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not open a channel until something subscribes", async () => {
    createWindowHidden();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tauri.channels).toHaveLength(0);
  });
});
