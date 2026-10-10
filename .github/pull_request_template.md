<!--
The title follows Conventional Commits, like the commits, in plain language
for someone reading the release notes: "fix: the queue no longer jumps back
to the playing song".
-->

## Problem

<!-- What was missing or broken, from the user's side, in a sentence or two.
For a bug, how to reproduce it. -->

## Change

<!-- What the app does now, then how it works where the diff doesn't make it
obvious. Split independent changes into separate PRs.

Add a diagram when the change isn't visible in the app but a picture explains
it better than prose:
- Flow across layers: data or events moving between the React app, the IPC
  package and the Rust side (Tauri commands, events, mpv, the SQLite library).
  Use a Mermaid sequence diagram or flowchart.
- State and lifecycle: a new or changed state machine, such as playback, the
  queue, sign-in, library scanning or updates. Use a Mermaid state diagram.
- Data shape: the database schema, stored settings or IPC payloads. Use a
  Mermaid ER diagram or a before and after code block.
- Measurements: speed, build time, binary or bundle size, memory. Use a before
  and after table with units and how you measured, or a chart image when there
  are many data points.
Skip it for small fixes, refactors that keep behaviour, dependency bumps,
docs-only changes, and anything where the diagram would repeat the diff.

Prefer Mermaid in a ```mermaid block: GitHub renders it and it stays diffable.
One idea per diagram, about 10 nodes at most. If you are an AI agent, draw the
diagram yourself instead of leaving a placeholder. For a chart or anything
Mermaid can't draw, build an HTML page and screenshot it with your harness's
preview tool (T3 Code's html_preview saves a PNG), then give the image to the
user to attach. -->

## Verification

<!-- The tests added and the manual checks you ran, with what you saw. Say
what you could not check. "Tests pass" on its own is not enough.

For anything visible in the app, add before and after screenshots: main and
this branch in the same state (same song, same window size, both playing or
both paused). Add a short recording when the change is about motion or
timing, such as scrolling, dragging or transitions. Paste or drag images into
this box. If you are an AI agent, give the images to the user in your reply so
they can add them. Don't commit images. Drop the table for changes with nothing
to see. -->

| Before | After |
| --- | --- |
|  |  |

<!-- If an agent did the work, end with its model and harness. -->
