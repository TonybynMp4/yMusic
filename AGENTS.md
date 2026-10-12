# Working on yMusic

How the built parts work, and why, is in `docs/`, one file per area. What is planned is in `PLAN.md`. Read both before starting a new area, and when an area gets built, move its design from `PLAN.md` into `docs/`. `PROGRESS.md` tracks what is built and what is left: tick items off in the commit that finishes them.

## Writing

- Never use em dashes. Use a comma, a colon, parentheses, a different sentence structure, or a new sentence. This covers code comments, commit messages, UI copy, docs, plans and replies.
- Avoid writing commit descriptions, keep commits concise and focused on the changes made, make more commits and proper documentation instead of bloating the git history. Commit subjects follow Conventional Commits (`feat: ...`, `fix: ...`, `docs: ...`) and become the GitHub release notes, so write them for someone reading what changed.
- Never use emojis, anywhere: UI, copy, commits, docs, replies. In the UI, use a Tabler icon (`@tabler/icons-react`) or nothing at all, if an icon would be needed but tabler doesn't provide one appropriate, ask the user to choose an alternative.
- Use the `unslop` skill whenever writing prose for a person to read: replies, plans, summaries, docs, commit messages, PR descriptions.

## UI

- Follow YouTube Music, not Spotify, for layout and behaviour.
- Components are shadcn on Base UI, not Radix.
- Volume is perceptual: mpv applies the cubic curve. Send the slider position as a linear fraction and do not apply the curve again.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
