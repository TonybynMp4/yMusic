#!/usr/bin/env node
// Cuts a release: `pnpm release 0.2.0`.
//
// The version lives in apps/desktop/package.json, which tauri.conf.json reads.
// Cargo keeps its own copy, so this writes both, turns the changelog's
// Unreleased section into the version's section, commits and tags. Pushing
// the tag (`git push --follow-tags`) runs .github/workflows/release.yml.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PACKAGE = "apps/desktop/package.json";
const CARGO = "apps/desktop/src-tauri/Cargo.toml";
const LOCK = "apps/desktop/src-tauri/Cargo.lock";
const CHANGELOG = "CHANGELOG.md";

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

const changelog = readFileSync(CHANGELOG, "utf8");
const unreleased = changelog.match(/^## Unreleased\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
if (!unreleased) fail(`${CHANGELOG} has no "## Unreleased" section.`);
if (!unreleased[1].trim()) fail(`${CHANGELOG} has nothing under Unreleased.`);
const date = new Date().toISOString().slice(0, 10);
writeFileSync(
  CHANGELOG,
  changelog.replace("## Unreleased\n", `## Unreleased\n\n## ${version} (${date})\n`),
);

const pkg = JSON.parse(readFileSync(PACKAGE, "utf8"));
pkg.version = version;
writeFileSync(PACKAGE, `${JSON.stringify(pkg, null, 2)}\n`);

// The first `version =` in Cargo.toml is the [package] one.
writeFileSync(CARGO, readFileSync(CARGO, "utf8").replace(/^version = ".*"$/m, `version = "${version}"`));
writeFileSync(
  LOCK,
  readFileSync(LOCK, "utf8").replace(/(name = "ymusic"\nversion = )".*"/, `$1"${version}"`),
);

git("add", PACKAGE, CARGO, LOCK, CHANGELOG);
git("commit", "--quiet", "-m", `Release ${tag}`);
git("tag", "--annotate", tag, "-m", `yMusic ${tag}`);
console.log(`Tagged ${tag}. Push it with: git push --follow-tags`);
