import { readFileSync, writeFileSync } from "node:fs";
import { heapStats } from "bun:jsc";

import { YouTubeEngine } from "../src/engine.ts";
import { lazyBotGuard } from "./botguard.ts";
import { openRecording } from "./replay.ts";
import { runPhase, SCENARIOS, type Phase, type Scenario } from "./scenario.ts";

/**
 * One measured session, in its own process, started by `run.ts`. Prints one
 * line of JSON: a point at startup and one after each phase.
 *
 * Linux only: each phase's peak comes from resetting the process's RSS high
 * water mark before it (`/proc/self/clear_refs`) and reading it after.
 */

export interface Point {
  phase: Phase | "start";
  /** What the phase got, from `runPhase`. */
  got: string;
  ms: number;
  /** Highest RSS while the phase ran, bytes. */
  peak: number;
  /** RSS after the phase and a full collection, bytes. */
  rss: number;
  /** Live JS heap after a full collection, bytes. */
  heap: number;
  /** Memory JS objects hold outside the heap (strings' and buffers' contents), bytes. */
  extra: number;
  objects: number;
  /** Most numerous live object types. */
  types: [string, number][];
}

const [dir, scenario, mode] = process.argv.slice(2);
if (!dir || !scenario || !(scenario in SCENARIOS)) {
  throw new Error("usage: child.ts <recording dir> <scenario> [record]");
}
const recording = openRecording(dir, mode === "record" ? "record" : "replay");
// With BotGuard, as in the app, so a stream the usual client fails on is
// retried on the fallback client.
const engine = new YouTubeEngine(recording.fetch, lazyBotGuard());

const points: Point[] = [{ phase: "start", got: "", ms: 0, peak: highWater(), ...settled() }];
for (const phase of SCENARIOS[scenario as Scenario]) {
  resetHighWater();
  const started = performance.now();
  const got = await runPhase(engine, phase);
  const ms = performance.now() - started;
  const peak = highWater();
  points.push({ phase, got, ms, peak, ...settled() });
}
const missing = recording.missing();
if (missing.length > 0) {
  console.error(`not in the recording:\n${missing.map((key) => key.slice(0, 300)).join("\n")}`);
  process.exit(1);
}
recording.save();
console.log(JSON.stringify(points));
process.exit(0);

function settled(): Omit<Point, "phase" | "got" | "ms" | "peak"> {
  Bun.gc(true);
  Bun.gc(true);
  const stats = heapStats();
  return {
    rss: process.memoryUsage().rss,
    heap: stats.heapSize,
    extra: stats.extraMemorySize,
    objects: stats.objectCount,
    types: Object.entries(stats.objectTypeCounts).sort((a, b) => b[1] - a[1]),
  };
}

function resetHighWater(): void {
  writeFileSync("/proc/self/clear_refs", "5");
}

function highWater(): number {
  const kb = /VmHWM:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"))?.[1];
  if (!kb) throw new Error("no VmHWM in /proc/self/status");
  return Number(kb) * 1024;
}
