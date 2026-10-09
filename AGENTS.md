# Working on yMusic

How the built parts work, and why, is in `docs/`, one file per area. What is planned is in `PLAN.md`. Read both before starting a new area, and when an area gets built, move its design from `PLAN.md` into `docs/`. `PROGRESS.md` tracks what is built and what is left: tick items off in the commit that finishes them.

## Writing

- Never use em dashes. Use a comma, a colon, parentheses, a different sentence structure, or a new sentence. This covers code comments, commit messages, UI copy, docs, plans and replies.
- Avoid writing commit descriptions, keep commits concise and focused on the changes made, make more commits and proper documentation instead of bloating the git history. Commit subjects follow Conventional Commits (`feat: ...`, `fix: ...`, `docs: ...`) and become the GitHub release notes, so write them for someone reading what changed.
- Never use emojis, anywhere: UI, copy, commits, docs, replies. In the UI, use a Tabler icon (`@tabler/icons-react`) or nothing at all, if an icon would be needed but tabler doesn't provide one appropriate, ask the user to choose an alternative.
- Use the `unslop` skill whenever writing prose for a person to read: replies, plans, summaries, docs, commit messages, PR descriptions.

## Subagents

Keep the main thread's context small: every file it reads is re-read on every later turn. Delegate work where the main thread only needs the result, and set the model on each spawn.

- Verification (tests, typecheck, lint, `cargo check`, `cargo fmt --check`): spawn a fresh Haiku subagent per round. It runs the commands and reports pass or fail plus the first error verbatim. Diagnosing and fixing stay in the main thread. Message the same subagent again only for an immediate follow-up on that failure, such as rerunning one test.
- Lookups (where X is defined, what imports Y): Haiku subagent, answering with `file:line` refs.
- Exploration (how an unfamiliar subsystem or a dependency under `node_modules` works): Sonnet subagent. It returns the relevant excerpts with `file:line` refs, enough that the main thread works from the summary without reopening the files.

## UI

- Follow YouTube Music, not Spotify, for layout and behaviour.
- Components are shadcn on Base UI, not Radix.
- Volume is perceptual: mpv applies the cubic curve. Send the slider position as a linear fraction and do not apply the curve again.
