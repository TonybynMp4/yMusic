#!/usr/bin/env node
// Compares two sets of harness runs and writes the report a PR embeds.
//
//   node scripts/memory/compare.mjs <before> [<after>] --out docs/memory/<slug> \
//     [--variant normal] [--scenario tray] [--title "..."]
//
// `<before>` and `<after>` are labels given to `run.mjs`. With only one label
// it describes that one, for a baseline. It writes
// `timeline.svg` (each process over the scenario, median of the runs, with
// the spread between runs shaded), `report.md` (the tables) and
// `summary.json` (the same numbers, for later comparisons).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
/** The last stretch of the run that "end of run" averages over, in seconds. */
const END_WINDOW_S = 60;
/** The processes reported on, in order, and "all" for their sum. */
const KINDS = [
  ["core", "Core (Rust, mpv)"],
  ["web", "Web process (UI, engine worker, BotGuard)"],
  ["network", "Network process"],
  ["all", "All processes"],
];
/** How far back a point of the CPU panels averages over, in seconds. */
const CPU_WINDOW_S = 10;

const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [beforeLabel, afterLabel] = positional;
const variant = option("--variant") ?? "normal";
const scenarioName = option("--scenario") ?? "session";
const TRAY = scenarioName === "tray";
const PHASES = TRAY
  ? ["idle", "playback", "browse", "search", "visible", "tray-hide", "tray-show"]
  : ["idle", "browse", "long-playlist", "playback", "idle-end"];
/** The tray scenario's three measured stretches, by the marks that bound them. */
const TRAY_WINDOWS = [
  ["visible", "Window open", "visible", "tray-hide"],
  ["hidden", "In the tray", "tray-hide", "tray-show"],
  ["shown", "Shown again", "tray-show", null],
];
const outArg = option("--out");
if (!beforeLabel || !outArg) {
  console.error(
    "usage: compare.mjs <before> [<after>] --out <dir> [--variant normal] [--scenario session|tray] [--title ...]",
  );
  process.exit(2);
}
const single = afterLabel === undefined;
const title = option("--title") ?? (single ? beforeLabel : `${beforeLabel} vs ${afterLabel}`);
const out = resolve(ROOT, outArg);

const before = load(beforeLabel);
const after = single ? before : load(afterLabel);
mkdirSync(out, { recursive: true });

const svgName = variant === "normal" ? "timeline.svg" : `timeline-${variant}.svg`;
const mdName = variant === "normal" ? "report.md" : `report-${variant}.md`;
const jsonName = variant === "normal" ? "summary.json" : `summary-${variant}.json`;
writeFileSync(join(out, svgName), timeline());
const summary = {
  title,
  variant,
  before: describe(before),
  after: describe(after),
};
writeFileSync(join(out, jsonName), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(out, mdName), report(summary));
console.log(`wrote ${relative(ROOT, out)}/{${svgName},${mdName},${jsonName}}`);

function load(label) {
  const dir = join(ROOT, ".memory/runs", label);
  if (!existsSync(dir)) throw new Error(`no runs for ${label} in ${relative(ROOT, dir)}`);
  const runs = readdirSync(dir)
    .filter((f) => f.startsWith(`${TRAY ? "tray-" : ""}${variant}-`) && f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  if (runs.length === 0) throw new Error(`no ${scenarioName} ${variant} runs for ${label}`);
  return { label, runs };
}

/** Megabytes of `metric` for one kind in one sample; "all" sums the processes. */
function value(sample, kind, metric) {
  const processes = sample.processes;
  const kb =
    kind === "all"
      ? Object.values(processes).reduce((sum, p) => sum + p[metric], 0)
      : (processes[kind]?.[metric] ?? 0);
  return metric === "threads" ? kb : kb / 1024;
}

/**
 * Anonymous memory plus swap: the heaps, JIT code and buffers the process
 * itself allocated, wherever they sit. Shared libraries and other file pages
 * are left out, because their PSS share drops whenever another program maps
 * the same libraries (any other WebKitGTK app does), which moves the number
 * without the app changing. Swap only ever holds anonymous pages.
 */
function held(sample, kind) {
  return value(sample, kind, "pssAnon") + value(sample, kind, "swap");
}

/** A cumulative counter for one kind in one sample; "all" sums the processes. */
function counter(sample, kind, pick) {
  const processes = kind === "all" ? Object.values(sample.processes) : [sample.processes[kind]];
  return processes.reduce((sum, p) => sum + (p ? pick(p) : 0), 0);
}

function cpuMs(p) {
  return p.cpuUser + p.cpuSystem;
}
function wakeupCount(p) {
  return p.wakeups;
}

/**
 * How fast a counter grew between `from` and `to`, per second, or null when
 * the run did not record it (runs from before the harness sampled CPU).
 */
function rate(run, kind, pick, from, to) {
  const within = run.samples.filter((s) => s.t >= from && s.t <= to);
  const first = within[0];
  const last = within.at(-1);
  if (!first || last.t <= first.t || first.processes.core.cpuUser === undefined) return null;
  return (counter(last, kind, pick) - counter(first, kind, pick)) / (last.t - first.t);
}

/** CPU over a stretch as a share of one core, in percent: 10 ms a second is 1%. */
function cpuShare(run, kind, from, to) {
  const msPerSecond = rate(run, kind, cpuMs, from, to);
  return msPerSecond === null ? null : msPerSecond / 10;
}

/** Mean held over the `seconds` before `until`. */
function heldBefore(run, kind, until, seconds) {
  const within = run.samples.filter((s) => s.t <= until && s.t >= until - seconds);
  if (within.length === 0) return null;
  return within.reduce((sum, s) => sum + held(s, kind), 0) / within.length;
}

/** What the tray scenario adds for one kind: each stretch's memory, CPU and wakeups. */
function trayMetrics(run, kind) {
  const last = run.samples.at(-1);
  const at = (phase) => (phase === null ? last.t : run.marks.find((m) => m.phase === phase)?.t);
  const found = {};
  for (const [key, , fromMark, toMark] of TRAY_WINDOWS) {
    const from = at(fromMark);
    const to = at(toMark);
    if (from === undefined || to === undefined) continue;
    // The window's last minute, or all of it when it is shorter.
    found[`${key}Held`] = heldBefore(run, kind, to, Math.min(END_WINDOW_S, to - from));
    found[`${key}Cpu`] = cpuShare(run, kind, from, to);
    found[`${key}Wakeups`] = rate(run, kind, wakeupCount, from, to);
  }
  if (found.shownHeld !== undefined && found.hiddenHeld !== undefined) {
    found.regained = found.shownHeld - found.hiddenHeld;
  }
  return found;
}

function runMetrics(run) {
  const last = run.samples.at(-1);
  const end = run.samples.filter((s) => s.t >= last.t - END_WINDOW_S);
  const mean = (kind, metric) =>
    end.reduce((sum, s) => sum + value(s, kind, metric), 0) / end.length;
  const metrics = {};
  for (const [kind] of KINDS) {
    metrics[kind] = {
      endHeld: mean(kind, "pssAnon") + mean(kind, "swap"),
      endSwap: mean(kind, "swap"),
      endPss: mean(kind, "pss"),
      peakHeld: Math.max(...run.samples.map((s) => held(s, kind))),
      peakRss: kind === "all" ? null : Math.max(...run.samples.map((s) => value(s, kind, "hwm"))),
      endThreads: value(last, kind, "threads"),
      ...(TRAY ? trayMetrics(run, kind) : {}),
    };
  }
  // Held by all processes at the end of each phase: the sample just before the
  // next phase starts, or the last one.
  const phases = {};
  for (const [i, phase] of PHASES.entries()) {
    const nextMark = run.marks.find((m) => m.phase === PHASES[i + 1]);
    const until = nextMark ? nextMark.t : last.t;
    const at = run.samples.filter((s) => s.t <= until).at(-1);
    if (at && run.marks.some((m) => m.phase === phase)) phases[phase] = held(at, "all");
  }
  const problems = run.marks
    .filter(
      (m) =>
        /^(error|stall|stuck)/.test(m.phase) ||
        (variant === "signed-in" && m.phase === "account signed-out"),
    )
    .map((m) => m.phase);
  const warnings = run.warnings?.length ?? 0;
  // Songs found playing at each beat in the tray: the queue kept advancing if
  // every beat found a different one.
  const traySongs = new Set(
    run.marks.filter((m) => m.phase.startsWith("tray-track ")).map((m) => m.phase),
  ).size;
  return {
    metrics,
    phases,
    problems,
    warnings,
    traySongs,
    durationS: last.t,
    timedOut: run.timedOut,
  };
}

function describe(set) {
  const per = set.runs.map(runMetrics);
  const stat = (pick) => {
    const values = per.map(pick).filter((v) => v !== null && v !== undefined);
    if (values.length === 0) return null;
    return { median: median(values), min: Math.min(...values), max: Math.max(...values) };
  };
  const metrics = {};
  for (const [kind] of KINDS) {
    metrics[kind] = {};
    for (const name of new Set(per.flatMap((r) => Object.keys(r.metrics[kind])))) {
      metrics[kind][name] = stat((r) => r.metrics[kind][name]);
    }
  }
  const phases = {};
  for (const phase of PHASES) phases[phase] = stat((r) => r.phases[phase]);
  return {
    label: set.label,
    runs: set.runs.length,
    commits: [...new Set(set.runs.map((r) => r.commit + (r.dirty ? "+dirty" : "")))],
    dates: [...new Set(set.runs.map((r) => r.startedAt.slice(0, 10)))],
    durationS: stat((r) => r.durationS),
    problems: per.flatMap((r) => r.problems),
    timedOut: per.filter((r) => r.timedOut).length,
    warnings: per.map((r) => r.warnings),
    traySongs: per.map((r) => r.traySongs),
    metrics,
    phases,
  };
}

function report(s) {
  const lines = [];
  lines.push(`### ${s.title}`, "");
  const scenario =
    { fallback: "Fallback (PO-token) scenario", "signed-in": "Signed-in scenario" }[s.variant] ??
    "Scenario";
  const named = TRAY ? `Tray: ${scenario[0].toLowerCase()}${scenario.slice(1)}` : scenario;
  const explained =
    "Medians, with the lowest and highest run in brackets. " +
    `"End" is the mean over the last ${END_WINDOW_S} s${TRAY ? ", with the window shown again" : " of idle"}; "held" is anonymous memory ` +
    "(PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.";
  if (single) {
    lines.push(
      `${named}, ${s.after.runs} runs of \`${s.after.label}\` (${s.after.commits.join(", ")}) ` +
        `on ${s.after.dates.join(", ")}. ${explained}`,
      "",
      "| Process | End, held | End, in swap | End, PSS | Peak, held | Peak RSS | Threads at end |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const [kind, name] of KINDS) {
      const m = s.after.metrics[kind];
      const cells = ["endHeld", "endSwap", "endPss", "peakHeld", "peakRss", "endThreads"].map(
        (metric) => (m[metric] ? cell(m[metric]) : ""),
      );
      lines.push(`| ${name} | ${cells.join(" | ")} |`);
    }
    lines.push("", "All processes, held at the end of each phase (MB):", "");
    lines.push("| Phase | Held |", "| --- | ---: |");
    for (const phase of PHASES) {
      if (s.after.phases[phase]) lines.push(`| ${phase} | ${cell(s.after.phases[phase])} |`);
    }
    if (TRAY) trayTables(s.after, lines);
    notes(s.after, lines);
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `${named}, ` +
      `${s.before.runs} runs of \`${s.before.label}\` (${s.before.commits.join(", ")}) and ` +
      `${s.after.runs} of \`${s.after.label}\` (${s.after.commits.join(", ")}), ` +
      `on ${[...new Set([...s.before.dates, ...s.after.dates])].join(", ")}. ${explained}`,
    "",
  );
  const table = (heading, metric) => {
    lines.push(
      heading,
      "",
      "| Process | Before | After | Change |",
      "| --- | ---: | ---: | ---: |",
    );
    for (const [kind, name] of KINDS) {
      const b = s.before.metrics[kind][metric];
      const a = s.after.metrics[kind][metric];
      if (b && a) lines.push(`| ${name} | ${cell(b)} | ${cell(a)} | ${change(b, a)} |`);
    }
    lines.push("");
  };
  table("End of run, held (MB):", "endHeld");
  table("End of run, in swap (MB):", "endSwap");
  table("End of run, PSS with shared libraries (MB):", "endPss");
  table("Peak, held (MB):", "peakHeld");
  table("Peak RSS, from `VmHWM` (MB):", "peakRss");
  table("Threads at end:", "endThreads");
  lines.push("All processes, held at the end of each phase (MB):", "");
  lines.push("| Phase | Before | After | Change |", "| --- | ---: | ---: | ---: |");
  for (const phase of PHASES) {
    const b = s.before.phases[phase];
    const a = s.after.phases[phase];
    if (!b || !a) continue;
    lines.push(`| ${phase} | ${cell(b)} | ${cell(a)} | ${change(b, a)} |`);
  }
  if (TRAY) {
    lines.push("");
    const windowed = (heading, suffix, digits) => {
      for (const [key, name] of TRAY_WINDOWS) {
        lines.push(
          `${name}, ${heading}:`,
          "",
          "| Process | Before | After | Change |",
          "| --- | ---: | ---: | ---: |",
        );
        for (const [kind, label] of KINDS) {
          const b = s.before.metrics[kind][`${key}${suffix}`];
          const a = s.after.metrics[kind][`${key}${suffix}`];
          if (b && a)
            lines.push(
              `| ${label} | ${cell(b, digits)} | ${cell(a, digits)} | ${change(b, a, digits)} |`,
            );
        }
        lines.push("");
      }
    };
    windowed("held (MB)", "Held", 0);
    table("Held more with the window shown again than in the tray (MB):", "regained");
    windowed("CPU (% of one core)", "Cpu", 1);
    windowed("wakeups per second", "Wakeups", 0);
    lines.pop();
    trayNotes(s.before, lines);
    trayNotes(s.after, lines);
  }
  notes(s.before, lines);
  notes(s.after, lines);
  return `${lines.join("\n")}\n`;
}

/**
 * The tray scenario's own tables for one set of runs: memory, CPU and wakeups
 * with the window open, in the tray and shown again.
 */
function trayTables(side, lines) {
  const heads = TRAY_WINDOWS.map(([, name]) => name);
  const rows = (suffix, digits, extra = []) => {
    lines.push(
      `| Process | ${[...heads, ...extra.map(([name]) => name)].join(" | ")} |`,
      `| --- | ${[...heads, ...extra].map(() => "---:").join(" | ")} |`,
    );
    for (const [kind, name] of KINDS) {
      const m = side.metrics[kind];
      const cells = [
        ...TRAY_WINDOWS.map(([key]) => m[`${key}${suffix}`]),
        ...extra.map(([, metric]) => m[metric]),
      ].map((stat) => (stat ? cell(stat, digits) : ""));
      lines.push(`| ${name} | ${cells.join(" | ")} |`);
    }
  };
  lines.push(
    "",
    `Held in each stretch (MB), as the mean over its last ${END_WINDOW_S} s. The last column is shown again minus in the tray:`,
    "",
  );
  rows("Held", 0, [["Shown again, change", "regained"]]);
  lines.push(
    "",
    "CPU over each whole stretch, as a share of one core (%): user plus system time from `/proc/<pid>/stat`.",
    "",
  );
  rows("Cpu", 1);
  lines.push(
    "",
    "Wakeups per second over each whole stretch: how often the process's threads were put on a CPU.",
    "",
  );
  rows("Wakeups", 0);
  trayNotes(side, lines);
}

function trayNotes(side, lines) {
  lines.push(
    "",
    `\`${side.label}\`: songs found playing in the tray, per run: ${side.traySongs.join(", ")}`,
  );
}

/** Anything that went wrong in a set of runs, so a number is not read without it. */
function notes(side, lines) {
  const found = [
    ...side.problems,
    ...(side.timedOut ? [`${side.timedOut} run(s) timed out`] : []),
    ...(side.warnings.some((n) => n > 0)
      ? [`warnings in the app log per run: ${side.warnings.join(", ")}`]
      : []),
  ];
  if (found.length) lines.push("", `\`${side.label}\`: ${found.join("; ")}`);
}

function cell(stat, digits = 0) {
  const f = (v) => (Number.isInteger(v) && digits === 0 ? String(v) : v.toFixed(digits));
  // "to", not a hyphen, wherever a value can be negative.
  const between = stat.min < 0 ? " to " : "-";
  return `${f(stat.median)} (${f(stat.min)}${between}${f(stat.max)})`;
}

function change(b, a, digits = 0) {
  const delta = a.median - b.median;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const pct = b.median <= 0 ? "" : ` (${sign}${Math.abs((delta / b.median) * 100).toFixed(0)}%)`;
  // Inside the before runs' own spread, the difference is noise.
  const noise = Math.abs(delta) <= b.max - b.min ? ", within noise" : "";
  return `${sign}${Math.abs(delta).toFixed(digits)}${pct}${noise}`;
}

function median(values) {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Each run's samples on a common grid, then the median and the range across
 * runs at each point. The grid stops at the shortest run, so every point has
 * every run behind it.
 */
function band(set, kind, cpu = false) {
  const end = Math.min(...set.runs.map((r) => r.samples.at(-1).t));
  const step = 2;
  const points = [];
  for (let t = 0; t <= end; t += step) {
    const values = set.runs.map((r) => {
      if (cpu) return cpuShare(r, kind, Math.max(0, t - CPU_WINDOW_S - step), t) ?? 0;
      const at = r.samples.findLast((s) => s.t <= t) ?? r.samples[0];
      return held(at, kind);
    });
    points.push({ t, median: median(values), min: Math.min(...values), max: Math.max(...values) });
  }
  return points;
}

/** Phase starts, as the median across runs. */
function phaseStarts(set) {
  return PHASES.map((phase) => {
    const times = set.runs.map((r) => r.marks.find((m) => m.phase === phase)?.t).filter(Boolean);
    return times.length ? { phase, t: median(times) } : null;
  }).filter(Boolean);
}

function timeline() {
  const width = 960;
  const panelHeight = 190;
  const left = 56;
  const right = 16;
  const top = 64;
  const gap = 46;
  const kinds = KINDS.filter(([kind]) => kind !== "network").map(([kind, name]) => [
    kind,
    name,
    false,
  ]);
  // The tray scenario is about CPU as much as memory, so it plots both.
  if (TRAY) {
    kinds.push(
      ["core", `Core, CPU (% of one core, ${CPU_WINDOW_S} s average)`, true],
      ["web", `Web process, CPU (% of one core, ${CPU_WINDOW_S} s average)`, true],
    );
  }
  const height = top + kinds.length * (panelHeight + gap) + 8;
  const plotWidth = width - left - right;
  const colors = { before: "#8a8f98", after: "#d6336c" };
  const bands = kinds.map(([kind, , cpu]) => ({
    before: band(before, kind, cpu),
    after: band(after, kind, cpu),
  }));
  const tMax = Math.max(...bands.flatMap((b) => [b.before.at(-1).t, b.after.at(-1).t]));
  const x = (t) => left + (t / tMax) * plotWidth;
  const phases = phaseStarts(after);
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, sans-serif" font-size="12">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="${left}" y="22" font-size="15" font-weight="600" fill="#1f2328">${escape(title)}</text>`,
    `<g transform="translate(${left}, 40)">`,
    ...(single
      ? [legend(0, colors.after, `${after.label} (${after.runs.length} runs)`)]
      : [
          legend(0, colors.before, `before: ${before.label} (${before.runs.length} runs)`),
          legend(260, colors.after, `after: ${after.label} (${after.runs.length} runs)`),
        ]),
    `<text x="520" y="4" fill="#59636e">line: median, shading: lowest to highest run. Anonymous + swap, MB</text>`,
    `</g>`,
  );
  for (const [i, [, name]] of kinds.entries()) {
    const y0 = top + i * (panelHeight + gap) + 18;
    const series = bands[i];
    const all = [...series.before, ...series.after];
    const { max: yMax, step: yStep } = scale(Math.max(...all.map((p) => p.max)));
    const y = (mb) => y0 + panelHeight - (mb / yMax) * panelHeight;
    parts.push(
      `<text x="${left}" y="${y0 - 8}" font-weight="600" fill="#1f2328">${escape(name)}</text>`,
    );
    // Phase bands, from the after runs' marks.
    for (const [j, p] of phases.entries()) {
      const x1 = x(p.t);
      const x2 = j + 1 < phases.length ? x(phases[j + 1].t) : x(tMax);
      if (j % 2 === 0) {
        parts.push(
          `<rect x="${x1}" y="${y0}" width="${Math.max(0, x2 - x1)}" height="${panelHeight}" fill="#f2f4f7"/>`,
        );
      }
      if (i === 0) {
        // Alternate rows, so short phases' labels do not overlap.
        parts.push(
          `<text x="${x1 + 4}" y="${y0 + 14 + (j % 2) * 13}" fill="#59636e" font-size="11">${p.phase}</text>`,
        );
      }
    }
    for (let mb = 0; mb <= yMax; mb += yStep) {
      parts.push(
        `<line x1="${left}" x2="${width - right}" y1="${y(mb)}" y2="${y(mb)}" stroke="#d0d7de" stroke-width="${mb === 0 ? 1 : 0.5}"/>`,
        `<text x="${left - 6}" y="${y(mb) + 4}" text-anchor="end" fill="#59636e">${mb.toFixed(0)}</text>`,
      );
    }
    for (const side of single ? ["after"] : ["before", "after"]) {
      const points = series[side];
      const upper = points.map((p) => `${x(p.t).toFixed(1)},${y(p.max).toFixed(1)}`);
      const lower = points.map((p) => `${x(p.t).toFixed(1)},${y(p.min).toFixed(1)}`).toReversed();
      parts.push(
        `<polygon points="${[...upper, ...lower].join(" ")}" fill="${colors[side]}" fill-opacity="0.18"/>`,
        `<polyline points="${points.map((p) => `${x(p.t).toFixed(1)},${y(p.median).toFixed(1)}`).join(" ")}" fill="none" stroke="${colors[side]}" stroke-width="2"${side === "before" ? ' stroke-dasharray="5 3"' : ""}/>`,
      );
    }
    // Minutes along the bottom.
    for (let m = 0; m * 60 <= tMax; m += tMax > 1200 ? 5 : 2) {
      parts.push(
        `<text x="${x(m * 60)}" y="${y0 + panelHeight + 16}" text-anchor="middle" fill="#59636e">${m} min</text>`,
      );
    }
  }
  parts.push("</svg>");
  return `${parts.join("\n")}\n`;
}

function legend(xOffset, color, text) {
  return (
    `<line x1="${xOffset}" x2="${xOffset + 22}" y1="0" y2="0" stroke="${color}" stroke-width="2.5"/>` +
    `<text x="${xOffset + 28}" y="4" fill="#1f2328">${escape(text)}</text>`
  );
}

/** A top for the axis with four or five round steps under it. */
function scale(v) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((st) => (v * 1.05) / st <= 5) ?? 1000;
  return { max: Math.ceil((v * 1.05) / step) * step, step };
}

function escape(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function option(name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}
