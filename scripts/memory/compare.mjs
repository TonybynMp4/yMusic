#!/usr/bin/env node
// Compares two sets of harness runs and writes the report a PR embeds.
//
//   node scripts/memory/compare.mjs <before> [<after>] --out docs/memory/<slug> \
//     [--variant normal] [--title "..."]
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
const PHASES = ["idle", "browse", "long-playlist", "playback", "idle-end"];

const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [beforeLabel, afterLabel] = positional;
const variant = option("--variant") ?? "normal";
const outArg = option("--out");
if (!beforeLabel || !outArg) {
  console.error("usage: compare.mjs <before> [<after>] --out <dir> [--variant normal] [--title ...]");
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
    .filter((f) => f.startsWith(`${variant}-`) && f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  if (runs.length === 0) throw new Error(`no ${variant} runs for ${label}`);
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

/** Resident plus swapped: what the process really holds, wherever it sits. */
function held(sample, kind) {
  return value(sample, kind, "pss") + value(sample, kind, "swap");
}

function runMetrics(run) {
  const last = run.samples.at(-1);
  const end = run.samples.filter((s) => s.t >= last.t - END_WINDOW_S);
  const mean = (kind, metric) => end.reduce((sum, s) => sum + value(s, kind, metric), 0) / end.length;
  const metrics = {};
  for (const [kind] of KINDS) {
    metrics[kind] = {
      endPss: mean(kind, "pss"),
      endSwap: mean(kind, "swap"),
      endHeld: mean(kind, "pss") + mean(kind, "swap"),
      peakHeld: Math.max(...run.samples.map((s) => held(s, kind))),
      peakRss: kind === "all" ? null : Math.max(...run.samples.map((s) => value(s, kind, "hwm"))),
      endThreads: value(last, kind, "threads"),
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
  return { metrics, phases, problems, warnings, durationS: last.t, timedOut: run.timedOut };
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
    for (const name of Object.keys(per[0].metrics[kind])) {
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
  const explained =
    "Medians, with the lowest and highest run in brackets. " +
    `"End" is the mean over the last ${END_WINDOW_S} s of idle; "held" is PSS plus swap.`;
  if (single) {
    lines.push(
      `${scenario}, ${s.after.runs} runs of \`${s.after.label}\` (${s.after.commits.join(", ")}) ` +
        `on ${s.after.dates.join(", ")}. ${explained}`,
      "",
      "| Process | End, held | End, in RAM | End, in swap | Peak, held | Peak RSS | Threads at end |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const [kind, name] of KINDS) {
      const m = s.after.metrics[kind];
      const cells = ["endHeld", "endPss", "endSwap", "peakHeld", "peakRss", "endThreads"].map(
        (metric) => (m[metric] ? cell(m[metric]) : ""),
      );
      lines.push(`| ${name} | ${cells.join(" | ")} |`);
    }
    lines.push("", "All processes, held at the end of each phase (MB):", "");
    lines.push("| Phase | Held |", "| --- | ---: |");
    for (const phase of PHASES) {
      if (s.after.phases[phase]) lines.push(`| ${phase} | ${cell(s.after.phases[phase])} |`);
    }
    notes(s.after, lines);
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `${scenario}, ` +
      `${s.before.runs} runs of \`${s.before.label}\` (${s.before.commits.join(", ")}) and ` +
      `${s.after.runs} of \`${s.after.label}\` (${s.after.commits.join(", ")}), ` +
      `on ${[...new Set([...s.before.dates, ...s.after.dates])].join(", ")}. ${explained}`,
    "",
  );
  const table = (heading, metric) => {
    lines.push(heading, "", "| Process | Before | After | Change |", "| --- | ---: | ---: | ---: |");
    for (const [kind, name] of KINDS) {
      const b = s.before.metrics[kind][metric];
      const a = s.after.metrics[kind][metric];
      if (b && a) lines.push(`| ${name} | ${cell(b)} | ${cell(a)} | ${change(b, a)} |`);
    }
    lines.push("");
  };
  table("End of run, held (MB):", "endHeld");
  table("End of run, in RAM (MB):", "endPss");
  table("End of run, in swap (MB):", "endSwap");
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
  notes(s.before, lines);
  notes(s.after, lines);
  return `${lines.join("\n")}\n`;
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

function cell(stat) {
  const f = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(0));
  return `${f(stat.median)} (${f(stat.min)}-${f(stat.max)})`;
}

function change(b, a) {
  const delta = a.median - b.median;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const pct = b.median === 0 ? "" : ` (${sign}${Math.abs((delta / b.median) * 100).toFixed(0)}%)`;
  // Inside the before runs' own spread, the difference is noise.
  const noise = Math.abs(delta) <= b.max - b.min ? ", within noise" : "";
  return `${sign}${Math.abs(delta).toFixed(0)}${pct}${noise}`;
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
function band(set, kind) {
  const end = Math.min(...set.runs.map((r) => r.samples.at(-1).t));
  const step = 2;
  const points = [];
  for (let t = 0; t <= end; t += step) {
    const values = set.runs.map((r) => {
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
  const kinds = KINDS.filter(([kind]) => kind !== "network");
  const height = top + kinds.length * (panelHeight + gap) + 8;
  const plotWidth = width - left - right;
  const colors = { before: "#8a8f98", after: "#d6336c" };
  const bands = Object.fromEntries(
    kinds.map(([kind]) => [kind, { before: band(before, kind), after: band(after, kind) }]),
  );
  const tMax = Math.max(
    ...kinds.flatMap(([kind]) => [bands[kind].before.at(-1).t, bands[kind].after.at(-1).t]),
  );
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
    `<text x="520" y="4" fill="#59636e">line: median, shading: lowest to highest run. PSS + swap, MB</text>`,
    `</g>`,
  );
  for (const [i, [kind, name]] of kinds.entries()) {
    const y0 = top + i * (panelHeight + gap) + 18;
    const series = bands[kind];
    const all = [...series.before, ...series.after];
    const { max: yMax, step: yStep } = scale(Math.max(...all.map((p) => p.max)));
    const y = (mb) => y0 + panelHeight - (mb / yMax) * panelHeight;
    parts.push(`<text x="${left}" y="${y0 - 8}" font-weight="600" fill="#1f2328">${escape(name)}</text>`);
    // Phase bands, from the after runs' marks.
    for (const [j, p] of phases.entries()) {
      const x1 = x(p.t);
      const x2 = j + 1 < phases.length ? x(phases[j + 1].t) : x(tMax);
      if (j % 2 === 0) {
        parts.push(`<rect x="${x1}" y="${y0}" width="${Math.max(0, x2 - x1)}" height="${panelHeight}" fill="#f2f4f7"/>`);
      }
      if (i === 0) {
        // Alternate rows, so short phases' labels do not overlap.
        parts.push(`<text x="${x1 + 4}" y="${y0 + 14 + (j % 2) * 13}" fill="#59636e" font-size="11">${p.phase}</text>`);
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
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
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
