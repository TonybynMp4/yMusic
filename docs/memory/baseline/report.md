### Baseline: main at v0.3.0

Scenario, 3 runs of `main` (56f1a7d+dirty) on 2026-10-09. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is PSS plus swap.

| Process | End, held | End, in RAM | End, in swap | Peak, held | Peak RSS | Threads at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Core (Rust, mpv) | 267 (267-273) | 267 (267-273) | 0 (0-0) | 273 (267-276) | 351 (347-358) | 49 (49-49) |
| Web process (UI, engine worker, BotGuard) | 405 (365-423) | 405 (365-423) | 0 (0-0) | 543 (519-570) | 693 (666-707) | 38 (38-40) |
| Network process | 16 (16-16) | 16 (16-16) | 0 (0-0) | 16 (16-16) | 51 (50-51) | 11 (11-11) |
| All processes | 694 (647-706) | 694 (647-706) | 0 (0-0) | 811 (776-811) |  | 98 (98-100) |

All processes, held at the end of each phase (MB):

| Phase | Held |
| --- | ---: |
| idle | 317 (317-319) |
| browse | 513 (506-533) |
| long-playlist | 536 (536-566) |
| playback | 677 (636-693) |
| idle-end | 698 (656-705) |
