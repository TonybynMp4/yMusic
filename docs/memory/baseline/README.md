# Baseline: `main` before the memory work

Three runs of each scenario on 2026-10-09, from `scripts/memory/run.mjs main`. The commit reads as dirty only because these reports were not committed yet.

| Scenario | Report | Chart |
| --- | --- | --- |
| Normal | [report.md](report.md) | [timeline.svg](timeline.svg) |
| Fallback (PO-token client) | [report-fallback.md](report-fallback.md) | [timeline-fallback.svg](timeline-fallback.svg) |
| Signed in | [report-signed-in.md](report-signed-in.md) | [timeline-signed-in.svg](timeline-signed-in.svg) |

Two runs went through memory pressure from other programs, and the kernel pushed part of the app to swap and dropped some of its file pages. That is why their end totals are the low ends of the ranges, and why the "in swap" columns are not zero everywhere:

- fallback run 1, while a headless browser was stuck in the background;
- signed-in run 3, while the network tests ran next to it.

The medians are the numbers to compare against. A later run that lands near a range's low end is not by itself a saving.

Every signed-in run stalled once on `syNLBJ_Lq9E`: it never reached playing within the scenario's wait, so the scenario skipped it. The player reports it as Premium-only for that session, a known sign-in issue outside this work. Signed-out runs play it fine.
