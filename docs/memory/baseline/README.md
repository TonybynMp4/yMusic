# Baseline: `main` before the memory work

Three runs of each scenario on 2026-10-09, from `scripts/memory/run.mjs main`. The commit reads as dirty only because these reports were not committed yet.

| Scenario | Report | Chart |
| --- | --- | --- |
| Normal | [report.md](report.md) | [timeline.svg](timeline.svg) |
| Fallback (PO-token client) | [report-fallback.md](report-fallback.md) | [timeline-fallback.svg](timeline-fallback.svg) |
| Signed in | [report-signed-in.md](report-signed-in.md) | [timeline-signed-in.svg](timeline-signed-in.svg) |

Two runs went through memory pressure from other programs, and the kernel pushed part of the app to swap:

- fallback run 1, while a headless browser was stuck in the background;
- signed-in run 3, while the network tests ran next to it.

"Held" counts anonymous memory wherever it sits, in RAM or swap, so those runs still compare. Their PSS column is lower, because the kernel also dropped file pages it could read back. Most of the remaining spread is the web process: it ends near 300 MB or near 450 to 500 MB depending on whether JavaScriptCore has released what the long playlist used. The medians are the numbers to compare against.

Every signed-in run stalled once on `syNLBJ_Lq9E`: it never reached playing within the scenario's wait, so the scenario skipped it. The player reports it as Premium-only for that session, a known sign-in issue outside this work. Signed-out runs play it fine.
