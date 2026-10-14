import { beforeEach, describe, expect, it } from "vitest";
import { Utils, type Platform } from "youtubei.js";

import { playerEvaluator } from "./client.ts";

type Evaluate = typeof Platform.shim.eval;
type Script = Parameters<Evaluate>[0];
type Env = { n?: string; sp?: string; sig?: string };

declare global {
  var compiledScripts: string[];
}

/**
 * Stands in for the code youtubei.js extracts from a player script. It counts
 * itself into `compiledScripts` each time it is compiled, and its transforms
 * are tagged with `version` so a stale compile shows in the result.
 */
function playerCode(version: string): string {
  return `
globalThis.compiledScripts.push(${JSON.stringify(version)});
var exportedVars = {
  nsigFunction: (url, sp, s) => {
    const n = new URL(url).searchParams.get("n");
    class Deciphered {
      get(name) {
        if (name === "n") return n ? "${version}:" + [...n].reverse().join("") : null;
        if (sp && name === sp) return s ? "${version}:" + s.toUpperCase() : null;
        return null;
      }
    }
    return new Deciphered();
  },
};`;
}

/** What youtubei.js passes for one URL: the code with its processor call appended. */
function script(code: string, env: Env): Script {
  return { output: `${code}\n${Utils.getNsigProcessorFn(env.n, env.sp, env.sig)}` } as Script;
}

async function run(evaluate: Evaluate, code: string, env: Env) {
  return evaluate(script(code, env), env);
}

describe("playerEvaluator", () => {
  beforeEach(() => {
    globalThis.compiledScripts = [];
  });

  it("deciphers n and the signature from the values it is given", async () => {
    const evaluate = playerEvaluator();
    const code = playerCode("v1");
    expect(await run(evaluate, code, { n: "abc" })).toEqual({ n: "v1:cba", sig: undefined });
    expect(await run(evaluate, code, { n: "xyz", sp: "sig", sig: "def" })).toEqual({
      n: "v1:zyx",
      sig: "v1:DEF",
    });
  });

  it("compiles a player script once however many URLs it deciphers", async () => {
    const evaluate = playerEvaluator();
    const code = playerCode("v1");
    for (const n of ["one", "two", "three"]) await run(evaluate, code, { n });
    expect(globalThis.compiledScripts).toEqual(["v1"]);
  });

  it("compiles again when the player script changes, and keeps only the latest", async () => {
    const evaluate = playerEvaluator();
    await run(evaluate, playerCode("v1"), { n: "abc" });
    expect(await run(evaluate, playerCode("v2"), { n: "abc" })).toMatchObject({ n: "v2:cba" });
    expect(await run(evaluate, playerCode("v1"), { n: "abc" })).toMatchObject({ n: "v1:cba" });
    expect(globalThis.compiledScripts).toEqual(["v1", "v2", "v1"]);
  });

  it("does not let a value break out of its string", async () => {
    const evaluate = playerEvaluator();
    const n = `"); globalThis.compiledScripts.push("injected"); ("`;
    const result = await run(evaluate, playerCode("v1"), { n });
    expect(result).toMatchObject({ n: `v1:${[...n].toReversed().join("")}` });
    expect(globalThis.compiledScripts).toEqual(["v1"]);
  });

  it("runs code without a processor call as it is", async () => {
    const evaluate = playerEvaluator();
    expect(await evaluate({ output: "return { n: 'plain' };" } as Script, {})).toEqual({
      n: "plain",
    });
  });
});
