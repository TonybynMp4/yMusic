@AGENTS.md

## Subagents

Keep the main thread's context small: everything it reads stays in context and is sent again on every later turn. Delegate work where the main thread only needs the result, and set the model on each spawn.

- Verification (tests, typecheck, lint, `cargo check`, `cargo fmt --check`): spawn a fresh Haiku subagent per round. It runs the commands and reports pass or fail, the first error verbatim, and a `file:line` list of any other errors. Diagnosing and fixing stay in the main thread. Message the same subagent again only for an immediate follow-up on that failure, such as rerunning one test.
- Lookups that take several searches or would return long output (where X is defined across packages, everything that imports Y): Haiku subagent, answering with `file:line` refs. A single search with a short answer runs in the main thread.
- Exploration (how an unfamiliar subsystem or a dependency under `node_modules` works): Sonnet subagent. It returns the relevant excerpts with `file:line` refs, enough that the main thread works from the summary without reopening the files.
