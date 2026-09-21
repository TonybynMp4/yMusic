# Working on YTBM

The plan and its reasoning live in `ytbm-plan.md`. Read it before starting a new area.

## Writing

- Never use em dashes (—). Use a comma, a colon, parentheses, or a new sentence. This covers code comments, commit messages, UI copy, docs, plans and replies.
- Never use emoji, anywhere: UI, copy, commits, docs, replies. In the UI, use a Tabler icon (`@tabler/icons-react`) or nothing at all.
- Use the `unslop` skill whenever writing prose for a person to read: replies, plans, summaries, docs, commit messages, PR descriptions.

## UI

- Follow YouTube Music, not Spotify, for layout and behaviour.
- Components are shadcn on Base UI, not Radix.
- Volume is perceptual: mpv applies the cubic curve. Send the slider position as a linear fraction and do not apply the curve again.
