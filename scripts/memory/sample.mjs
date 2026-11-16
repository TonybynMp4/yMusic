#!/usr/bin/env node
// Samples the memory and CPU of yMusic's processes from /proc (Linux only).
//
// As a module it gives `sample(rootPid)`, which `run.mjs` calls every two
// seconds. On its own it watches a running app and prints a line per sample:
//
//   node scripts/memory/sample.mjs [pid] [--every 2]
//
// Without a pid it picks the newest process named `ymusic`.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The app's processes, by what `/proc/<pid>/comm` calls them. */
const KINDS = [
  ["web", /^WebKitWebProces/],
  ["network", /^WebKitNetworkPr/],
  ["gpu", /^WebKitGPUProces/],
];

/** Clock ticks per second, which `/proc/<pid>/stat` counts CPU time in. */
const TICK_MS = 1000 / clockTicks();
/**
 * Times each thread has been given the CPU, as last read, and the total since
 * the first sample per process. A thread's count goes with it when it exits,
 * so the total is kept here from the differences rather than summed afresh.
 */
const lastSlices = new Map();
const wakeupTotals = new Map();

/**
 * One sample of the app rooted at `rootPid` and its direct children, which
 * is where WebKitGTK starts its processes. Values are in kB; a kind with
 * several processes (two web processes, say) is summed.
 */
export function sample(rootPid) {
  const processes = { core: read(rootPid) };
  if (processes.core === null) return null;
  for (const pid of children(rootPid)) {
    const comm = text(`/proc/${pid}/comm`)?.trim() ?? "";
    const kind = KINDS.find(([, pattern]) => pattern.test(comm))?.[0] ?? "other";
    const values = read(pid);
    if (values === null) continue;
    processes[kind] = processes[kind] ? add(processes[kind], values) : values;
  }
  return processes;
}

function read(pid) {
  const rollup = text(`/proc/${pid}/smaps_rollup`);
  const status = text(`/proc/${pid}/status`);
  if (rollup === null || status === null) return null;
  return {
    pss: field(rollup, "Pss"),
    pssAnon: field(rollup, "Pss_Anon"),
    swap: field(rollup, "SwapPss"),
    rss: field(status, "VmRSS"),
    hwm: field(status, "VmHWM"),
    threads: field(status, "Threads"),
    ...cpu(pid),
    wakeups: wakeups(pid),
  };
}

/**
 * CPU time the process has used since it started, in ms: `utime` and `stime`,
 * fields 14 and 15 of `/proc/<pid>/stat`. They count every thread, including
 * ones that have exited.
 */
function cpu(pid) {
  const stat = text(`/proc/${pid}/stat`);
  const fields = stat?.slice(stat.lastIndexOf(")") + 2).split(" ") ?? [];
  return {
    cpuUser: Math.round(Number(fields[11] ?? 0) * TICK_MS),
    cpuSystem: Math.round(Number(fields[12] ?? 0) * TICK_MS),
  };
}

/**
 * How many times the process's threads have been put on a CPU since the first
 * sample of it: the third number of each `/proc/<pid>/task/<tid>/schedstat`.
 * A thread that is asleep adds nothing, so this counts wakeups. What a thread
 * did between its last sample and its exit is missed.
 */
function wakeups(pid) {
  let total = wakeupTotals.get(pid) ?? 0;
  let tids = [];
  try {
    tids = readdirSync(`/proc/${pid}/task`);
  } catch {
    return total;
  }
  for (const tid of tids) {
    const slices = Number(text(`/proc/${pid}/task/${tid}/schedstat`)?.split(" ")[2]);
    if (!Number.isFinite(slices)) continue;
    const key = `${pid}:${tid}`;
    const before = lastSlices.get(key);
    // A thread first seen counts from here, so the total starts at zero.
    if (before !== undefined && slices > before) total += slices - before;
    lastSlices.set(key, slices);
  }
  wakeupTotals.set(pid, total);
  return total;
}

function clockTicks() {
  try {
    return Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" })) || 100;
  } catch {
    return 100;
  }
}

function add(a, b) {
  return Object.fromEntries(Object.keys(a).map((key) => [key, a[key] + b[key]]));
}

function children(pid) {
  const found = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const stat = text(`/proc/${entry}/stat`);
    // The command name is in parentheses and may hold spaces; ppid follows it.
    const ppid = stat?.slice(stat.lastIndexOf(")") + 2).split(" ")[1];
    if (ppid === String(pid)) found.push(Number(entry));
  }
  return found;
}

function field(source, name) {
  const match = source.match(new RegExp(`^${name}:\\s+(\\d+)`, "m"));
  return match ? Number(match[1]) : 0;
}

function text(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function newest(name) {
  let best = null;
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry) || text(`/proc/${entry}/comm`)?.trim() !== name) continue;
    const stat = text(`/proc/${entry}/stat`);
    if (stat === null) continue;
    const start = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
    if (best === null || start > best.start) best = { pid: Number(entry), start };
  }
  return best?.pid ?? null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const everyAt = args.indexOf("--every");
  const every = everyAt === -1 ? 2 : Number(args.splice(everyAt, 2)[1]);
  const pid = args[0] ? Number(args[0]) : newest("ymusic");
  if (pid === null) {
    console.error("no ymusic process is running");
    process.exit(1);
  }
  const mb = (kb) => (kb / 1024).toFixed(0).padStart(5);
  const tick = () => {
    const now = sample(pid);
    if (now === null) process.exit(0);
    const parts = Object.entries(now).map(
      ([kind, v]) => `${kind} ${mb(v.pss)} MB +${mb(v.swap)} swap`,
    );
    console.log(`${new Date().toISOString().slice(11, 19)}  ${parts.join("   ")}`);
  };
  tick();
  setInterval(tick, every * 1000);
}
