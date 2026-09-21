#!/usr/bin/env node
// Prints a release's notes: `node scripts/release-notes.mjs v0.2.0`.
//
// Every commit since the previous tag, grouped by its Conventional Commits
// type, as "**title** by @author in #pull" (or the short hash when the commit
// has no pull request). Authors and pull requests come from GitHub's API when
// GITHUB_TOKEN and GITHUB_REPOSITORY are set; otherwise the git author name.

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

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: node scripts/release-notes.mjs <tag>");
  process.exit(1);
}
const previous = (() => {
  try {
    return git("describe", "--tags", "--abbrev=0", `${tag}^`);
  } catch {
    return null;
  }
})();

const commits = git("log", "--no-merges", "--reverse", "--format=%H%x1f%s%x1f%an", previous ? `${previous}..${tag}` : tag)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sha, subject, name] = line.split("\x1f");
    const match = subject.match(/^(\w+)(\(([^)]+)\))?(!)?: (.+)$/);
    const type = match && SECTIONS.some(([t]) => t === match[1]) ? match[1] : "other";
    const title = match && type !== "other" ? (match[3] ? `${match[3]}: ${match[5]}` : match[5]) : subject;
    return { sha, title, breaking: Boolean(match?.[4]), type, authors: [name], pull: null };
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
  for (const c of group) {
    lines.push(`- ${c.breaking ? "**BREAKING** " : ""}**${c.title}** by ${people(c.authors)} in ${link(c)}`);
  }
}
if (previous && repository) {
  lines.push("", `**Full changelog**: ${server}/${repository}/compare/${previous}...${tag}`);
}
console.log(lines.join("\n"));
