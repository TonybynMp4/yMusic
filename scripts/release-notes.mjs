#!/usr/bin/env node
// Prints a release's notes: `node scripts/release-notes.mjs v0.2.0 [commit]`.
//
// Every commit since the previous tag, grouped by its Conventional Commits
// type, as "**subject** by @author in #pull" (or the short hash when the commit
// has no pull request). Authors and pull requests come from GitHub's API when
// GITHUB_TOKEN and GITHUB_REPOSITORY are set; otherwise the git author name.
//
// The commit defaults to the tag. Pass it when the tag doesn't exist yet, as
// for a draft. A stable release counts from the previous stable tag, so its
// notes cover everything its prereleases shipped too. Dependency bumps are
// folded into one line, and release commits are left out.

import { execFileSync } from "node:child_process";

const SECTIONS = [
  ["feat", "Features"],
  ["fix", "Bug fixes"],
  ["perf", "Performance"],
  ["refactor", "Refactoring"],
  ["docs", "Documentation"],
  ["test", "Tests"],
  ["build", "Build"],
  ["ci", "CI"],
  ["style", "Style"],
  ["revert", "Reverts"],
  ["chore", "Chores"],
  ["other", "Other changes"],
];

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const [tag, head = tag] = process.argv.slice(2);
if (!tag) {
  console.error("Usage: node scripts/release-notes.mjs <tag> [commit]");
  process.exit(1);
}
const prerelease = tag.includes("-");
const previous = (() => {
  try {
    const exclude = prerelease ? [] : ["--exclude", "*-*"];
    return git("describe", "--tags", "--abbrev=0", "--match", "v*", "--exclude", tag, ...exclude, head);
  } catch {
    return null;
  }
})();

const DEPENDENCIES = /^build\(deps(-dev)?\)/;

const commits = git("log", "--no-merges", "--reverse", "--format=%H%x1f%s%x1f%an", previous ? `${previous}..${head}` : head)
  .split("\n")
  .filter(Boolean)
  .filter((line) => !line.split("\x1f")[1].startsWith("chore: release v"))
  .map((line) => {
    const [sha, subject, name] = line.split("\x1f");
    const match = subject.match(/^(\w+)(\([^)]+\))?!?: /);
    const type = match && SECTIONS.some(([t]) => t === match[1]) ? match[1] : "other";
    return { sha, title: subject, type, authors: [name], pull: null };
  });

// One GraphQL request per 50 commits: every author (co-authors included) and
// the pull request each commit came from.
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
if (token && repository) {
  const [owner, name] = repository.split("/");
  for (let i = 0; i < commits.length; i += 50) {
    const batch = commits.slice(i, i + 50);
    const fields = batch
      .map(
        (c, j) => `c${j}: object(oid: "${c.sha}") { ... on Commit {
          authors(first: 10) { nodes { name user { login } } }
          associatedPullRequests(first: 1) { nodes { number } }
        } }`,
      )
      .join("\n");
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { authorization: `bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
        variables: { owner, name },
      }),
    });
    const { data, errors } = await response.json();
    if (errors) throw new Error(JSON.stringify(errors));
    batch.forEach((c, j) => {
      const found = data.repository[`c${j}`];
      if (!found) return;
      c.authors = found.authors.nodes.map((a) => (a.user ? `@${a.user.login}` : a.name));
      c.pull = found.associatedPullRequests.nodes[0]?.number ?? null;
    });
  }
}

const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const link = (c) =>
  c.pull ? `#${c.pull}` : repository ? `[${c.sha.slice(0, 7)}](${server}/${repository}/commit/${c.sha})` : c.sha.slice(0, 7);
const people = (authors) => {
  const unique = [...new Set(authors)];
  return unique.length > 1 ? `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}` : unique[0];
};

const lines = ["## What's changed"];
for (const [type, heading] of SECTIONS) {
  const group = commits.filter((c) => c.type === type);
  if (!group.length) continue;
  lines.push("", `### ${heading}`, "");
  const bumps = group.filter((c) => DEPENDENCIES.test(c.title));
  for (const c of group) {
    if (bumps.includes(c)) continue;
    lines.push(`- **${c.title}** by ${people(c.authors)} in ${link(c)}`);
  }
  if (bumps.length) {
    const title = bumps.length > 1 ? `${bumps.length} dependency updates` : "1 dependency update";
    lines.push(`- **${title}** by ${people(bumps.flatMap((c) => c.authors))} in ${bumps.map(link).join(", ")}`);
  }
}
if (previous && repository) {
  lines.push("", `**Full changelog**: ${server}/${repository}/compare/${previous}...${tag}`);
}
console.log(lines.join("\n"));
