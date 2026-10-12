#!/usr/bin/env node
// Samples the memory of yMusic's processes: from /proc on Linux, and from
// Win32_Process through a PowerShell kept running on Windows.
//
// As a module it gives `sample(rootPid)`, which `run.mjs` calls every two
// seconds. On its own it watches a running app and prints a line per sample:
//
//   node scripts/memory/sample.mjs [pid] [--every 2]
//
// Without a pid it picks the newest process named `ymusic`.

import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/** The app's processes, by what `/proc/<pid>/comm` calls them. */
const KINDS = [
  ["web", /^WebKitWebProces/],
  ["network", /^WebKitNetworkPr/],
  ["gpu", /^WebKitGPUProces/],
];

/**
 * One sample of the app rooted at `rootPid` and its direct children, which
 * is where WebKitGTK starts its processes. Values are in kB; a kind with
 * several processes (two web processes, say) is summed.
 */
export function sample(rootPid) {
  if (process.platform === "win32") return sampleWindows(rootPid);
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

/**
 * WebView2's processes, by their `--type` switch. The one with no switch is
 * the browser process that starts the rest; it counts as "other".
 */
const WINDOWS_KINDS = [
  ["web", /--type=renderer/],
  ["gpu", /--type=gpu-process/],
  ["network", /--utility-sub-type=network\./],
];
/** The newest list of the app's processes from the PowerShell below. */
let windowsSnapshot = null;

/**
 * Windows has no PSS. Private bytes, memory only this process holds whether
 * in RAM or the page file, is the closest match to anonymous memory plus swap,
 * so it fills `pssAnon` and swap stays 0; `pss` and `rss` take the working set.
 * The tree is ymusic.exe, the WebView2 browser process it starts, and that
 * process's children.
 */
function sampleWindows(rootPid) {
  startWindowsSampler();
  const all = windowsSnapshot;
  if (all === null) return null;
  const root = all.find((p) => p.ProcessId === rootPid);
  if (!root) return null;
  const tree = new Set([rootPid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of all) {
      if (!tree.has(p.ProcessId) && tree.has(p.ParentProcessId)) {
        tree.add(p.ProcessId);
        grew = true;
      }
    }
  }
  const processes = { core: windowsValues(root) };
  for (const p of all) {
    if (p.ProcessId === rootPid || !tree.has(p.ProcessId)) continue;
    const kind = WINDOWS_KINDS.find(([, pattern]) => pattern.test(p.CommandLine ?? ""))?.[0] ?? "other";
    const values = windowsValues(p);
    processes[kind] = processes[kind] ? add(processes[kind], values) : values;
  }
  return processes;
}

function windowsValues(p) {
  const kb = (bytes) => Math.round(Number(bytes) / 1024);
  return {
    pss: kb(p.WorkingSetSize),
    pssAnon: kb(p.PrivatePageCount),
    swap: 0,
    rss: kb(p.WorkingSetSize),
    // Win32_Process gives this one in kB already.
    hwm: Number(p.PeakWorkingSetSize),
    threads: Number(p.ThreadCount),
  };
}

/** Asking WMI from a fresh PowerShell takes a second or more, so one stays up. */
function startWindowsSampler() {
  if (startWindowsSampler.started) return;
  startWindowsSampler.started = true;
  const script = `
    while ($true) {
      $list = @(Get-CimInstance Win32_Process -Filter "Name='ymusic.exe' OR Name='msedgewebview2.exe'" |
        Select-Object ProcessId, ParentProcessId, CommandLine, PrivatePageCount, WorkingSetSize, PeakWorkingSetSize, ThreadCount)
      ConvertTo-Json -InputObject $list -Compress -Depth 2
      Start-Sleep -Milliseconds 1000
    }`;
  const shell = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  createInterface({ input: shell.stdout }).on("line", (line) => {
    try {
      windowsSnapshot = JSON.parse(line);
    } catch {
      // A line split by the console; the next one replaces it.
    }
  });
  process.on("exit", () => shell.kill());
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
  };
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
  const pid = args[0] ? Number(args[0]) : process.platform === "win32" ? null : newest("ymusic");
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
