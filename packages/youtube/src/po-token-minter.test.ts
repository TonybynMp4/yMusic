import { describe, expect, it, vi } from "vitest";

import { PoTokenMinter, type BotGuardVm } from "./po-token.ts";

vi.mock("bgutils-js/botguard", () => ({
  getChallenge: async () => ({
    program: "program",
    globalName: "bg",
    interpreterJavascript: { privateDoNotAccessOrElseSafeScriptWrappedValue: "interpreter" },
  }),
}));

/** Answers GenerateIT with an integrity token good for an hour. */
const fetch = (async () => Response.json(["integrity", 3600, 300])) as typeof globalThis.fetch;

/** A VM whose minter can be dropped, as closing the app's BotGuard frame does. */
function droppableVm() {
  let minter = false;
  const vm = {
    load: vi.fn<BotGuardVm["load"]>(async () => "attestation"),
    createMinter: vi.fn<BotGuardVm["createMinter"]>(async () => {
      minter = true;
    }),
    mint: vi.fn<BotGuardVm["mint"]>(async (binding) => {
      if (!minter) throw new Error("no minter");
      return `token for ${binding}`;
    }),
    drop: () => {
      minter = false;
    },
  } satisfies BotGuardVm & { drop(): void };
  return vm;
}

describe("PoTokenMinter", () => {
  it("builds a new minter when the VM lost the last one", async () => {
    const vm = droppableVm();
    const minter = new PoTokenMinter(fetch, vm);
    expect(await minter.mint("a")).toBe("token for a");

    vm.drop();
    expect(await minter.mint("b")).toBe("token for b");
    expect(vm.createMinter).toHaveBeenCalledTimes(2);
  });

  it("reuses the minter while it lasts", async () => {
    const vm = droppableVm();
    const minter = new PoTokenMinter(fetch, vm);
    await minter.mint("a");
    await minter.mint("b");
    expect(vm.load).toHaveBeenCalledTimes(1);
  });

  it("gives up after one fresh minter fails too", async () => {
    const vm = droppableVm();
    const minter = new PoTokenMinter(fetch, vm);
    await minter.mint("a");
    vm.mint.mockRejectedValue(new Error("broken"));
    await expect(minter.mint("b")).rejects.toThrow("broken");
    expect(vm.createMinter).toHaveBeenCalledTimes(2);
  });
});
