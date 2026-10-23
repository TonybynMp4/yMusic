#!/usr/bin/env node
// Drive the real desktop app (Tauri, mpv, IPC) through tauri-driver, so an
// agent can click through it and look at it. See docs/testing.md.
//
//   node scripts/drive.mjs start [--visible] [--signed-in] [--audio] [--no-build]
//   node scripts/drive.mjs snapshot
//   node scripts/drive.mjs click <ref|css>
//   node scripts/drive.mjs type <ref|css> <text>
//   node scripts/drive.mjs press <key>
//   node scripts/drive.mjs wait <text> [seconds]
//   node scripts/drive.mjs shot [file.png]
//   node scripts/drive.mjs eval <js>
//   node scripts/drive.mjs logs
//   node scripts/drive.mjs stop

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(root, "apps/desktop/src-tauri");
const binary = join(tauriDir, "target/debug/ymusic");
// Per user and private: it holds the state `stop` acts on and, with
// --signed-in, a copy of your session.
const work = process.env.XDG_RUNTIME_DIR
  ? join(process.env.XDG_RUNTIME_DIR, "ymusic-drive")
  : join(tmpdir(), `ymusic-drive-${process.getuid()}`);
const statePath = join(work, "state.json");
const vitePort = 1420;
// tauri-driver has no auth and launches whatever binary a new session names,
// so it listens on a random port rather than the well-known 4444.
let base = null;

const keys = {
  Enter: "",
  Escape: "",
  Tab: "",
  Backspace: "",
  Space: " ",
  ArrowUp: "",
  ArrowDown: "",
  ArrowLeft: "",
  ArrowRight: "",
};

function ensureWork() {
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const stat = lstatSync(work);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
    fail(`${work} must be a directory you own with mode 0700`);
}

function readState() {
  if (!existsSync(statePath)) return null;
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (state.port) base = `http://127.0.0.1:${state.port}`;
  return state;
}

function requireState() {
  const state = readState();
  if (!state) fail("no app running, run `start` first");
  return state;
}

class Failure extends Error {}

function fail(message) {
  throw new Failure(message);
}

const save = (state) => writeFileSync(statePath, JSON.stringify(state));

const freePort = () =>
  new Promise((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

const portOpen = (port) =>
  new Promise((done) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => (socket.destroy(), done(true)));
    socket.once("error", () => done(false));
  });

async function waitForPort(port, seconds, what) {
  for (let i = 0; i < seconds * 4; i++) {
    if (await portOpen(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`${what} did not come up on port ${port}, see ${work}`);
}

function background(command, args, log, env) {
  const fd = openSync(join(work, log), "w");
  const child = spawn(command, args, { cwd: root, detached: true, stdio: ["ignore", fd, fd], env });
  child.unref();
  return child.pid;
}

async function wd(method, path, body) {
  const init = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(base + path, init);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) fail(`webdriver ${method} ${path}: ${json.value?.message ?? response.status}`);
  return json.value;
}

const session = (state, method, path, body) => wd(method, `/session/${state.session}${path}`, body);

async function find(state, target) {
  const css = /^e\d+$/.test(target) ? `[data-agent-ref="${target}"]` : target;
  const found = await session(state, "POST", "/element", { using: "css selector", value: css });
  return Object.values(found)[0];
}

async function start(flags) {
  if (!existsSync("/usr/bin/WebKitWebDriver"))
    fail("WebKitWebDriver is missing: sudo apt install webkitgtk-webdriver");

  if (!flags.has("--no-build")) {
    console.log("building the debug binary");
    const build = spawnSync("cargo", ["build"], { cwd: tauriDir, stdio: "inherit" });
    if (build.status !== 0) fail("cargo build failed");
  }

  // The debug binary loads the frontend from the Vite dev server.
  let vite = null;
  if (!(await portOpen(vitePort))) {
    vite = background("pnpm", ["--filter", "@ymusic/desktop", "dev"], "vite.log", process.env);
    save({ vite });
    await waitForPort(vitePort, 30, "vite");
  }
  save({ vite });

  // A private profile, D-Bus session and (by default) X display: the app
  // does not touch your library or keyring, the single-instance lock does
  // not hand off to a yMusic you already have open, and nothing plays aloud.
  const profile = join(work, "profile");
  rmSync(profile, { recursive: true, force: true });
  const dataDir = join(profile, "data", "dev.tony.ymusic");
  mkdirSync(dataDir, { recursive: true });
  const env = {
    ...process.env,
    XDG_DATA_HOME: join(profile, "data"),
    XDG_CONFIG_HOME: join(profile, "config"),
    XDG_CACHE_HOME: join(profile, "cache"),
  };
  if (!flags.has("--audio")) env.YMUSIC_AUDIO_OUTPUT = "null";
  if (flags.has("--signed-in")) {
    // A copy of your sealed session, and its key in a file rather than the
    // keyring: signing out in the copy cannot sign out your own app.
    const realData = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "dev.tony.ymusic");
    if (!existsSync(join(realData, "account.bin"))) fail("not signed in: no account.bin in " + realData);
    copyFileSync(join(realData, "account.bin"), join(dataDir, "account.bin"));
    const key = join(profile, "account.key");
    // The private profile and the timeout are for a binary older than
    // `--export-account-key`, which would start the whole app instead.
    const exported = spawnSync(binary, ["--export-account-key", key], { stdio: "inherit", env, timeout: 15000 });
    if (exported.status !== 0 || !existsSync(key))
      fail("could not export the account key, is the binary older than --export-account-key? Drop --no-build");
    env.YMUSIC_ACCOUNT_KEY_FILE = key;
  }
  const port = await freePort();
  const driverArgs = ["tauri-driver", "--port", String(port), "--native-port", String(await freePort())];
  const wrap = flags.has("--visible")
    ? ["dbus-run-session", "--", ...driverArgs]
    : ["dbus-run-session", "--", "xvfb-run", "-a", "-s", "-screen 0 1440x900x24", ...driverArgs];
  if (!flags.has("--visible")) env.GDK_BACKEND = "x11";
  const driver = background(wrap[0], wrap.slice(1), "driver.log", env);
  save({ vite, driver, port });
  base = `http://127.0.0.1:${port}`;
  await waitForPort(port, 15, "tauri-driver");

  const created = await wd("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application: binary } } },
  });
  save({ session: created.sessionId, driver, vite, port });
  console.log(`app running, logs in ${work}`);
}

async function stop() {
  const state = readState();
  if (!state) return console.log("nothing running");
  if (state.session && base) await fetch(`${base}/session/${state.session}`, { method: "DELETE" }).catch(() => {});
  for (const pid of [state.driver, state.vite]) {
    // Only a process group start spawned; -1 would signal everything.
    if (!Number.isInteger(pid) || pid <= 1) continue;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
  }
  rmSync(statePath, { force: true });
  rmSync(join(work, "profile", "account.key"), { force: true });
  console.log("stopped");
}

// Lists what is on screen: headings, visible text blocks and every control,
// each control tagged with a ref that `click` and `type` accept.
const snapshotScript = `
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };
  const label = (el) =>
    (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.value ||
      el.getAttribute("placeholder") || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  const controls = 'button, a[href], input, textarea, select, [role="button"], [role="menuitem"],' +
    '[role="option"], [role="tab"], [role="slider"], [role="checkbox"], [role="switch"], [role="link"]';
  document.querySelectorAll("[data-agent-ref]").forEach((el) => el.removeAttribute("data-agent-ref"));
  const lines = [];
  let n = 0;
  const walk = (el, depth) => {
    for (const child of el.children) {
      if (!visible(child) && child.children.length === 0) continue;
      if (child.matches(controls)) {
        if (!visible(child)) continue;
        const ref = "e" + ++n;
        child.setAttribute("data-agent-ref", ref);
        const role = child.getAttribute("role") || child.tagName.toLowerCase();
        const state = [
          child.disabled && "disabled",
          child.getAttribute("aria-pressed") === "true" && "pressed",
          child.getAttribute("aria-checked") === "true" && "checked",
          child.getAttribute("aria-selected") === "true" && "selected",
          child.getAttribute("aria-valuenow") && "value=" + child.getAttribute("aria-valuenow"),
        ].filter(Boolean).join(" ");
        lines.push("  ".repeat(depth) + ref + " " + role + ' "' + label(child) + '"' + (state ? " " + state : ""));
        continue;
      }
      if (/^H[1-6]$/.test(child.tagName) && visible(child)) {
        lines.push("  ".repeat(depth) + child.tagName.toLowerCase() + ' "' + label(child) + '"');
        continue;
      }
      const role = child.getAttribute("role");
      const landmark = ["dialog", "menu", "listbox", "alert", "status"].includes(role) ||
        ["NAV", "MAIN", "ASIDE", "HEADER", "FOOTER"].includes(child.tagName);
      if (landmark && visible(child)) {
        lines.push("  ".repeat(depth) + (role || child.tagName.toLowerCase()) +
          (child.getAttribute("aria-label") ? ' "' + child.getAttribute("aria-label") + '"' : ""));
        walk(child, depth + 1);
        continue;
      }
      const own = [...child.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(" ").trim();
      if (own && visible(child)) lines.push("  ".repeat(depth) + "text " + JSON.stringify(own.replace(/\\s+/g, " ").slice(0, 120)));
      walk(child, depth);
    }
  };
  walk(document.body, 0);
  return location.pathname + location.hash + "\\n" + lines.join("\\n");
`;

const [command, ...args] = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));

try {
  if (command) ensureWork();
  await run();
} catch (error) {
  if (!(error instanceof Failure)) throw error;
  console.error(error.message);
  process.exit(1);
}

async function run() {
  switch (command) {
    case "start":
      if (readState()) fail("already running, run `stop` first");
      // A failed start stops whatever it got running, and the key file with it.
      await start(flags).catch(async (error) => {
        if (readState()) await stop();
        throw error;
      });
      break;
    case "stop":
      await stop();
      break;
    case "snapshot": {
      const state = requireState();
      console.log(await session(state, "POST", "/execute/sync", { script: snapshotScript, args: [] }));
      break;
    }
    case "click": {
      const state = requireState();
      const el = await find(state, args[0]);
      await session(state, "POST", `/element/${el}/click`, {});
      break;
    }
    case "type": {
      const state = requireState();
      const el = await find(state, args[0]);
      await session(state, "POST", `/element/${el}/value`, { text: args.slice(1).join(" ") });
      break;
    }
    case "press": {
      const state = requireState();
      const value = keys[args[0]] ?? args[0];
      await session(state, "POST", "/actions", {
        actions: [{ type: "key", id: "kb", actions: [{ type: "keyDown", value }, { type: "keyUp", value }] }],
      });
      break;
    }
    case "wait": {
      const state = requireState();
      const deadline = Date.now() + Number(args[1] ?? 10) * 1000;
      while (Date.now() < deadline) {
        const text = await session(state, "POST", "/execute/sync", { script: "return document.body.innerText", args: [] });
        if (text.includes(args[0])) process.exit(0);
        await new Promise((r) => setTimeout(r, 300));
      }
      fail(`"${args[0]}" did not appear`);
      break;
    }
    case "shot": {
      const state = requireState();
      const file = resolve(args[0] ?? join(work, `shot-${Date.now()}.png`));
      writeFileSync(file, Buffer.from(await session(state, "GET", "/screenshot"), "base64"));
      console.log(file);
      break;
    }
    case "eval": {
      const state = requireState();
      const value = await session(state, "POST", "/execute/sync", { script: args.join(" "), args: [] });
      console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
      break;
    }
    case "logs":
      console.log(readFileSync(join(work, "driver.log"), "utf8").split("\n").slice(-60).join("\n"));
      break;
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 16).join("\n"));
  }
}
