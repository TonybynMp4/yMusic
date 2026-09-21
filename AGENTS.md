# Working on yMusic

The design and its reasoning live in `PLAN.md`; read it before starting a new area. `PROGRESS.md` tracks what is built and what is left: tick items off in the commit that finishes them.

## Writing

- Never use em dashes. Use a comma, a colon, parentheses, a different sentence structure, or a new sentence. This covers code comments, commit messages, UI copy, docs, plans and replies.
- Avoid writing commit descriptions, keep commits concise and focused on the changes made, make more commits and proper documentation instead of bloating the git history.
- Never use emojis, anywhere: UI, copy, commits, docs, replies. In the UI, use a Tabler icon (`@tabler/icons-react`) or nothing at all, if an icon would be needed but tabler doesn't provide one appropriate, ask the user to choose an alternative.
- Use the `unslop` skill whenever writing prose for a person to read: replies, plans, summaries, docs, commit messages, PR descriptions.

## UI

- Follow YouTube Music, not Spotify, for layout and behaviour.
- Components are shadcn on Base UI, not Radix.
- Volume is perceptual: mpv applies the cubic curve. Send the slider position as a linear fraction and do not apply the curve again.
