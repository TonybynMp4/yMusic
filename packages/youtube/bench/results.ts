import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Point } from "./child.ts";
import type { Scenario } from "./scenario.ts";

/**
 * Where recordings and results live: in the user's cache rather than the
 * checkout, so every worktree measures against the same recording and can
 * compare against another worktree's result by its label.
 */
export const HOME = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "ymusic", "engine-memory");

export function recordingDir(name: string): string {
  return name.includes("/") ? name : join(HOME, "recordings", name);
}

/** `quick` results keep the bare label, so those from before scenarios still load. */
export function resultPath(label: string, scenario: Scenario = "quick"): string {
  if (label.endsWith(".json")) return label;
  const name = label.replaceAll("/", "-") + (scenario === "quick" ? "" : `.${scenario}`);
  return join(HOME, "results", `${name}.json`);
}

export interface Stat {
  median: number;
  min: number;
  max: number;
}

export interface PhaseSummary {
  phase: Point["phase"];
  got: string;
  ms: Stat;
  peak: Stat;
  heap: Stat;
  extra: Stat;
  rss: Stat;
  types: [string, number][];
}

export interface Result {
  label: string;
  scenario?: Scenario;
  commit: string;
  recording: string;
  date: string;
  runs: number;
  phases: PhaseSummary[];
}

export function loadResult(label: string, scenario?: Scenario): Result {
  const path = resultPath(label, scenario);
  if (!existsSync(path)) throw new Error(`no result ${path}; run bench/run.ts on that branch first`);
  return JSON.parse(readFileSync(path, "utf8")) as Result;
}

export function stat(values: number[]): Stat {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { median, min: sorted[0]!, max: sorted[sorted.length - 1]! };
}

export function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}
