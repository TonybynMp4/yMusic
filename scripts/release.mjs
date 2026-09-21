#!/usr/bin/env node
// Cuts a release: `pnpm release 0.2.0`.
//
// The version lives in apps/desktop/package.json, which tauri.conf.json reads.
// Cargo keeps its own copy, so this writes both, commits and tags. Pushing the
// tag (`git push --follow-tags`) runs .github/workflows/release.yml, which
// writes the notes with scripts/release-notes.mjs.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PACKAGE = "apps/desktop/package.json";
const CARGO = "apps/desktop/src-tauri/Cargo.toml";
const LOCK = "apps/desktop/src-tauri/Cargo.lock";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  fail("Usage: pnpm release <version>, for example 0.2.0 or 0.2.0-beta.1");
}
const tag = `v${version}`;

if (git("status", "--porcelain")) fail("The working tree has changes. Commit or stash them first.");
if (git("branch", "--show-current") !== "main") fail("Releases are cut from main.");
if (git("tag", "--list", tag)) fail(`${tag} already exists.`);

const pkg = JSON.parse(readFileSync(PACKAGE, "utf8"));
pkg.version = version;
writeFileSync(PACKAGE, `${JSON.stringify(pkg, null, 2)}\n`);

// The first `version =` in Cargo.toml is the [package] one.
writeFileSync(CARGO, readFileSync(CARGO, "utf8").replace(/^version = ".*"$/m, `version = "${version}"`));
writeFileSync(
  LOCK,
  readFileSync(LOCK, "utf8").replace(/(name = "ymusic"\nversion = )".*"/, `$1"${version}"`),
);

git("add", PACKAGE, CARGO, LOCK);
// Nothing to commit when the version is already this one, as for the first release.
if (git("diff", "--cached", "--name-only")) git("commit", "--quiet", "-m", `chore: release ${tag}`);
git("tag", "--annotate", tag, "-m", `yMusic ${tag}`);
console.log(`Tagged ${tag}. Push it with: git push --follow-tags`);
