import { parseArgs } from "node:util";

import { loadResult, mb, type Stat } from "./results.ts";
import type { Scenario } from "./scenario.ts";

/**
 * Compares two results by label (or path to their JSON):
 *
 *   bun bench/compare.ts main my-branch [--scenario session]
 *
 * A peak change no larger than the wider of the two sides' spreads between
 * runs is marked as within noise. Retained heap barely varies between runs, so any change there
 * is real.
 */

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { scenario: { type: "string", default: "quick" } },
});
const [beforeLabel, afterLabel] = positionals;
if (!beforeLabel || !afterLabel) throw new Error("usage: compare.ts <before> <after> [--scenario session]");
const before = loadResult(beforeLabel, values.scenario as Scenario);
const after = loadResult(afterLabel, values.scenario as Scenario);
if (before.recording !== after.recording) {
  console.warn(`different recordings: ${before.recording} and ${after.recording}\n`);
}
if ((before.scenario ?? "quick") !== (after.scenario ?? "quick")) {
  console.warn(`different scenarios: ${before.scenario ?? "quick"} and ${after.scenario ?? "quick"}\n`);
}

console.log(
  `${before.label} (${before.commit}) against ${after.label} (${after.commit}), medians in MB\n`,
);
console.log("| Phase | Peak RSS | Change | Retained JS heap + extra | Change |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const a of after.phases) {
  const b = before.phases.find((p) => p.phase === a.phase);
  if (!b) continue;
  const retained = (s: { heap: Stat; extra: Stat }) => s.heap.median + s.extra.median;
  console.log(
    `| ${a.phase} | ${mb(b.peak.median)} → ${mb(a.peak.median)} | ${change(b.peak, a.peak)} | ${mb(retained(b))} → ${mb(retained(a))} | ${signed(retained(a) - retained(b))} |`,
  );
  if (a.got !== b.got) console.log(`|  | got: ${b.got} → ${a.got} | | | |`);
}

// The last phase both ran, so the counts come from the same point of the session.
const shared = after.phases.findLast((a) => before.phases.some((b) => b.phase === a.phase));
const typesAt = (r: typeof before) =>
  new Map(r.phases.find((p) => p.phase === shared?.phase)?.types ?? []);
const typesBefore = typesAt(before);
const typesAfter = typesAt(after);
const moved = [...new Set([...typesBefore.keys(), ...typesAfter.keys()])]
  .map((type) => [type, (typesAfter.get(type) ?? 0) - (typesBefore.get(type) ?? 0)] as const)
  .filter(([, delta]) => delta !== 0)
  .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
  .slice(0, 10);
if (moved.length > 0) {
  console.log(`\nLive objects after ${shared!.phase}, largest changes in count:\n`);
  for (const [type, delta] of moved) console.log(`- ${type}: ${delta > 0 ? "+" : ""}${delta}`);
}

function change(b: Stat, a: Stat): string {
  const delta = a.median - b.median;
  const noise = Math.max(b.max - b.min, a.max - a.min);
  return `${signed(delta)}${Math.abs(delta) <= noise ? ", within noise" : ""}`;
}

function signed(bytes: number): string {
  return `${bytes >= 0 ? "+" : ""}${mb(bytes)}`;
}
