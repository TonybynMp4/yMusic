# Working on yMusic

How the built parts work, and why, is in `docs/`, one file per area. What is planned is in `PLAN.md`. Read both before starting a new area, and when an area gets built, move its design from `PLAN.md` into `docs/`. `PROGRESS.md` tracks what is built and what is left: tick items off in the commit that finishes them.

## Writing

- Never use em dashes. Use a comma, a colon, parentheses, a different sentence structure, or a new sentence. This covers code comments, commit messages, UI copy, docs, plans and replies.
- Avoid writing commit descriptions, keep commits concise and focused on the changes made, make more commits and proper documentation instead of bloating the git history. Commit subjects follow Conventional Commits (`feat: ...`, `fix: ...`, `docs: ...`) and become the GitHub release notes, so write them for someone reading what changed.
- Never use emojis, anywhere: UI, copy, commits, docs, replies. In the UI, use a Tabler icon (`@tabler/icons-react`) or nothing at all, if an icon would be needed but tabler doesn't provide one appropriate, ask the user to choose an alternative.
- Use the `unslop` skill whenever writing prose for a person to read: replies, plans, summaries, docs, commit messages, PR descriptions.

## Formatting

oxfmt formats TypeScript, JSON, CSS and Markdown, with its settings in `.oxfmtrc.json`. Run `pnpm format` before committing: CI runs `pnpm format:check` and fails on any unformatted file. Rust goes through `cargo fmt`.

## Git hooks

lefthook runs the hooks in `lefthook.yml`. `pnpm install` installs them through lefthook's postinstall, which `allowBuilds` in `pnpm-workspace.yaml` lets run and which does nothing when `CI` is set. Worktrees share one hooks directory, so installing in any of them covers all, and each commit uses the `lefthook.yml` and `node_modules` of the worktree it is made in. A worktree without `node_modules`, or on a branch from before lefthook, commits with no checks.

- pre-commit runs on staged files only, in parallel: oxlint, oxfmt (formats and re-stages), and rustfmt (formats and re-stages) when `.rs` files are staged. rustfmt also formats the child modules of a staged `lib.rs` or `mod.rs`. Without rustfmt installed, the Rust job prints a message and passes.
- commit-msg rejects a subject that is not a Conventional Commit. Git's own `Merge`, `Revert "` and `fixup!` subjects pass.

Typecheck, clippy and the tests take too long for every commit, so they run in CI only. Skip the hooks for one commit with `git commit --no-verify`, or for a whole shell with `LEFTHOOK=0`.

GitHub skips the commits in `.git-blame-ignore-revs` when showing blame. For local `git blame` to skip them too, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once. Add the squash commit of any future bulk reformat there.

## Test-driving the app

To see a change, or take before and after screenshots, run the app in a browser from a recording with `pnpm --filter @ymusic/desktop dev:replay`. It needs no account and makes no requests. See `docs/replay.md`, including what to do when a screen needs data the recording lacks.

## UI

- Follow YouTube Music, not Spotify, for layout and behaviour.
- Components are shadcn on Base UI, not Radix.
- Volume is perceptual: mpv applies the cubic curve. Send the slider position as a linear fraction and do not apply the curve again.
