#!/usr/bin/env node
// Builds the memory harness's app, runs its scripted scenario and samples it.
//
//   node scripts/memory/run.mjs <label> [--runs 3] [--variant fallback|signed-in] [--skip-build]
//   node scripts/memory/run.mjs --sign-in
//
// Each run starts from a clean data directory under the harness's own
// identifier, `dev.tony.ymusic.memory`, so it runs beside an installed yMusic
// and never touches its library, settings or session. `--sign-in` opens the
// app to sign in once and keeps the saved session in `.memory/account.bin`;
// `--variant signed-in` puts it back before each run. Results go to
// `.memory/runs/<label>/<variant>-<n>.json`; `compare.mjs` reads them.
// See docs/memory.md.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, release } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { sample } from "./sample.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const IDENTIFIER = "dev.tony.ymusic.memory";
const EVERY_MS = 2_000;
/** Far longer than the scenario takes; past it the run is killed and kept. */
const RUN_LIMIT_MS = 40 * 60_000;
/** Between runs, so the last one's exit does not show in the next. */
const SETTLE_MS = 10_000;

const args = process.argv.slice(2);
const signIn = args.includes("--sign-in");
const label = args.find((a) => !a.startsWith("--") && !isValue(a));
const runs = Number(option("--runs") ?? 3);
const variant = option("--variant") ?? "normal";
if (
  (!label && !signIn) ||
  !["normal", "fallback", "signed-in"].includes(variant) ||
  !(runs > 0)
) {
  console.error(
    "usage: run.mjs <label> [--runs 3] [--variant normal|fallback|signed-in] [--skip-build]\n" +
      "       run.mjs --sign-in",
  );
  process.exit(2);
}

/** The signed-in runs use the normal build; only what is in its folders differs. */
const buildVariant = variant === "fallback" ? "fallback" : "normal";
const binary = join(ROOT, ".memory/bin", buildVariant, "ymusic");
const savedAccount = join(ROOT, ".memory/account.bin");
if (!args.includes("--skip-build")) build();
if (signIn) {
  await captureSession();
  process.exit(0);
}
if (variant === "signed-in" && !existsSync(savedAccount)) {
  console.error("no saved session: run `node scripts/memory/run.mjs --sign-in` first");
  process.exit(2);
}

const out = join(ROOT, ".memory/runs", label);
mkdirSync(out, { recursive: true });
for (let n = 1; n <= runs; n++) {
  if (n > 1) await sleep(SETTLE_MS);
  console.log(`${label} ${variant} run ${n}/${runs}`);
  const result = await runOnce();
  const file = join(out, `${variant}-${n}.json`);
  writeFileSync(file, JSON.stringify(result));
  const problems = result.marks.filter((m) => /^(error|stall|stuck)/.test(m.phase));
  console.log(
    `  ${result.samples.length} samples, ${Math.round(result.durationMs / 1000)} s, ` +
      `${result.timedOut ? "timed out" : "finished"}, ${result.warnings.length} warnings in the log` +
      (problems.length ? `, ${problems.map((m) => m.phase).join("; ")}` : ""),
  );
}

function build() {
  console.log(`building the ${buildVariant} scenario build`);
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@ymusic/desktop",
      "tauri",
      "build",
      "--no-bundle",
      "--config",
      "src-tauri/tauri.memory.conf.json",
      "--features",
      "memory-scenario",
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        VITE_MEMORY_SCENARIO: buildVariant === "fallback" ? "fallback" : "on",
        // Its own target directory, so the feature does not invalidate the
        // usual release build's artifacts and the other way round.
        CARGO_TARGET_DIR: join(ROOT, ".memory/target"),
      },
    },
  );
  mkdirSync(dirname(binary), { recursive: true });
  copyFileSync(join(ROOT, ".memory/target/release/ymusic"), binary);
}

async function runOnce() {
  for (const dir of dataDirs()) rmSync(dir, { recursive: true, force: true });
  if (variant === "signed-in") {
    mkdirSync(dataDirs()[0], { recursive: true });
    copyFileSync(savedAccount, join(dataDirs()[0], "account.bin"));
  }
  const meta = {
    label,
    variant,
    commit: git("rev-parse", "--short", "HEAD"),
    dirty: git("status", "--porcelain").length > 0,
    kernel: release(),
    startedAt: new Date().toISOString(),
    memAvailableKb: meminfo("MemAvailable"),
    swapFreeKb: meminfo("SwapFree"),
  };

  const child = spawn(binary, [], { stdio: ["ignore", "pipe", "pipe"] });
  const started = Date.now();
  const marks = [];
  const samples = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    const match = line.match(/^ymemory-mark (.+)$/);
    if (match) marks.push({ t: (Date.now() - started) / 1000, phase: match[1] });
  });
  // Drained so a chatty log cannot fill the pipe and block the app.
  child.stderr.resume();

  const exited = new Promise((resolve) => child.on("exit", resolve));
  let timedOut = false;
  const timer = setInterval(() => {
    const now = sample(child.pid);
    if (now) samples.push({ t: (Date.now() - started) / 1000, processes: now });
  }, EVERY_MS);
  const limit = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, RUN_LIMIT_MS);
  await exited;
  clearInterval(timer);
  clearTimeout(limit);
  return {
    ...meta,
    durationMs: Date.now() - started,
    timedOut,
    marks,
    warnings: warnings(),
    samples,
  };
}

/**
 * Opens the app from clean folders and waits for a sign-in, then keeps the
 * session the app saved. Its key stays in the keyring under the harness's own
 * entry, `ymusic-memory`, so the copy only opens for this build.
 */
async function captureSession() {
  for (const dir of dataDirs()) rmSync(dir, { recursive: true, force: true });
  const saved = join(dataDirs()[0], "account.bin");
  console.log("sign in from the app's Sign in button; it closes once the session is saved");
  const child = spawn(binary, [], {
    stdio: "ignore",
    env: { ...process.env, YMUSIC_MEMORY_SIGN_IN: "1" },
  });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  while (child.exitCode === null && !existsSync(saved)) await sleep(1_000);
  if (child.exitCode !== null) {
    console.error("the app closed before a session was saved");
    process.exit(1);
  }
  // The file is renamed into place whole, but the app may still be writing
  // the library it fetched after signing in; none of that is kept.
  await sleep(3_000);
  mkdirSync(dirname(savedAccount), { recursive: true });
  copyFileSync(saved, savedAccount);
  child.kill("SIGTERM");
  await exited;
  console.log(`saved the session to ${savedAccount}`);
}

/** The app's own warnings and errors from the run, such as a stream mpv refused. */
function warnings() {
  const log = join(dataDirs()[0], "logs", "yMusic.log");
  const text = existsSync(log) ? readFileSync(log, "utf8") : "";
  return text
    .split("\n")
    .filter((line) => /\]\[(WARN|ERROR)\]/.test(line))
    .slice(0, 100);
}

function dataDirs() {
  const home = homedir();
  return [
    join(process.env.XDG_DATA_HOME || join(home, ".local/share"), IDENTIFIER),
    join(process.env.XDG_CACHE_HOME || join(home, ".cache"), IDENTIFIER),
    join(process.env.XDG_CONFIG_HOME || join(home, ".config"), IDENTIFIER),
  ];
}

function meminfo(name) {
  const match = readFileSync("/proc/meminfo", "utf8").match(new RegExp(`^${name}:\\s+(\\d+)`, "m"));
  return match ? Number(match[1]) : null;
}

function git(...command) {
  return execFileSync("git", command, { cwd: ROOT, encoding: "utf8" }).trim();
}

function option(name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function isValue(arg) {
  const at = args.indexOf(arg);
  return at > 0 && ["--runs", "--variant"].includes(args[at - 1]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
