import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import type { Point } from "./child.ts";
import {
  mb,
  recordingDir,
  resultPath,
  stat,
  type PhaseSummary,
  type Result,
} from "./results.ts";

/**
 * Measures the engine's memory over the scenario in `scenario.ts`, against
 * recorded responses. See `docs/engine-memory.md`.
 *
 *   bun bench/run.ts [--record] [--runs 5] [--recording default] [--label <branch>]
 */

const { values } = parseArgs({
  options: {
    record: { type: "boolean", default: false },
    runs: { type: "string", default: "5" },
    recording: { type: "string", default: "default" },
    label: { type: "string" },
  },
});

const dir = recordingDir(values.recording);
const runs = Number(values.runs);
const label = values.label ?? git("branch", "--show-current").replaceAll("/", "-");
if (!label) throw new Error("detached HEAD; pass --label");
const child = join(import.meta.dir, "child.ts");

if (values.record) {
  console.log(`recording missing responses into ${dir}`);
  await session(["record"]);
}

const sessions: Point[][] = [];
for (let i = 0; i < runs; i++) {
  sessions.push(await session([]));
  process.stdout.write(`run ${i + 1}/${runs}\r`);
}
process.stdout.write("\n");

const phases: PhaseSummary[] = sessions[0]!.map((first, index) => {
  const points = sessions.map((run) => run[index]!);
  const got = new Set(points.map((p) => p.got));
  if (got.size > 1) throw new Error(`runs disagree on ${first.phase}: ${[...got].join(" / ")}`);
  return {
    phase: first.phase,
    got: first.got,
    ms: stat(points.map((p) => p.ms)),
    peak: stat(points.map((p) => p.peak)),
    heap: stat(points.map((p) => p.heap)),
    extra: stat(points.map((p) => p.extra)),
    rss: stat(points.map((p) => p.rss)),
    types: first.types,
  };
});

const result: Result = {
  label,
  commit: git("rev-parse", "--short", "HEAD"),
  recording: dir,
  date: new Date().toISOString(),
  runs,
  phases,
};
const out = resultPath(label);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));

console.log(`${label} (${result.commit}), ${runs} runs, medians in MB\n`);
console.log("| Phase | Peak RSS | Retained JS heap + extra | Time | Got |");
console.log("| --- | ---: | ---: | ---: | --- |");
for (const p of phases) {
  console.log(
    `| ${p.phase} | ${mb(p.peak.median)} (${mb(p.peak.min)}-${mb(p.peak.max)}) | ${mb(p.heap.median)} + ${mb(p.extra.median)} | ${p.ms.median.toFixed(0)} ms | ${p.got} |`,
  );
}
console.log(`\nsaved to ${out}`);

async function session(args: string[]): Promise<Point[]> {
  const proc = Bun.spawn([process.execPath, child, dir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    const hint = stderr.includes("not in the recording")
      ? "\nThis branch makes a request the recording lacks; rerun with --record to add it."
      : "";
    throw new Error(`session failed (exit ${code}):\n${stderr.slice(-2000)}${hint}`);
  }
  return JSON.parse(stdout.trim().split("\n").pop()!) as Point[];
}

function git(...args: string[]): string {
  return Bun.spawnSync(["git", ...args], { cwd: import.meta.dir }).stdout.toString().trim();
}
