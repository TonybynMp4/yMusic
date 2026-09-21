#!/usr/bin/env node
// Sets the app version and prints it: `node scripts/bump.mjs <patch|minor|major|x.y.z>`.
//
// The version lives in apps/desktop/package.json, which tauri.conf.json reads.
// Cargo keeps its own copy, so this writes both. `--dry-run` only prints.

import { readFileSync, writeFileSync } from "node:fs";

const PACKAGE = "apps/desktop/package.json";
const CARGO = "apps/desktop/src-tauri/Cargo.toml";
const LOCK = "apps/desktop/src-tauri/Cargo.lock";
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.]+)?$/;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const input = args.find((a) => a !== "--dry-run")?.replace(/^v/, "");

const pkg = JSON.parse(readFileSync(PACKAGE, "utf8"));
const current = pkg.version.match(SEMVER);
if (!current) throw new Error(`${PACKAGE} has an invalid version: ${pkg.version}`);
const [major, minor, patch] = current.slice(1, 4).map(Number);

const version = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  // A prerelease's patch bump releases that version rather than skipping it.
  patch: current[4] ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`,
}[input] ?? input;

if (!version || !SEMVER.test(version)) {
  console.error("Usage: node scripts/bump.mjs <patch|minor|major|x.y.z> [--dry-run]");
  process.exit(1);
}

if (!dryRun) {
  pkg.version = version;
  writeFileSync(PACKAGE, `${JSON.stringify(pkg, null, 2)}\n`);
  // The first `version =` in Cargo.toml is the [package] one.
  writeFileSync(CARGO, readFileSync(CARGO, "utf8").replace(/^version = ".*"$/m, `version = "${version}"`));
  writeFileSync(
    LOCK,
    readFileSync(LOCK, "utf8").replace(/(name = "ymusic"\nversion = )".*"/, `$1"${version}"`),
  );
}
console.log(version);
