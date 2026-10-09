### Baseline: main at v0.3.0, fallback client

Fallback (PO-token) scenario, 3 runs of `main` (56f1a7d+dirty, e28d377+dirty) on 2026-10-09. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is PSS plus swap.

| Process | End, held | End, in RAM | End, in swap | Peak, held | Peak RSS | Threads at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Core (Rust, mpv) | 258 (254-269) | 258 (111-269) | 0 (0-143) | 269 (258-274) | 348 (339-358) | 49 (49-49) |
| Web process (UI, engine worker, BotGuard) | 421 (355-600) | 421 (203-600) | 0 (0-152) | 596 (553-640) | 714 (667-729) | 38 (38-40) |
| Network process | 17 (16-17) | 17 (9-17) | 0 (0-6) | 17 (17-17) | 51 (51-51) | 11 (11-11) |
| All processes | 697 (625-885) | 697 (324-885) | 0 (0-301) | 794 (785-908) |  | 98 (98-100) |

All processes, held at the end of each phase (MB):

| Phase | Held |
| --- | ---: |
| idle | 311 (292-313) |
| browse | 496 (466-500) |
| long-playlist | 519 (492-527) |
| playback | 677 (667-867) |
| idle-end | 700 (632-889) |
