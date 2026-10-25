### Prune small maps, signed in

Signed-in scenario, 3 runs of `pr4-no-player-script` (2662e3b) and 3 of `pr6-small-maps` (52b3ee3), on 2026-10-11. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 121 (121-121) | 127 (122-127) | +6 (+5%) |
| Web process (UI, engine worker, BotGuard) | 413 (286-481) | 474 (321-474) | +61 (+15%), within noise |
| Network process | 7 (7-7) | 8 (7-8) | +0 (+0%) |
| All processes | 542 (414-610) | 604 (456-608) | +62 (+11%), within noise |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-0) | 0 (0-0) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-0) | 0 (0-0) | 0, within noise |
| Network process | 0 (0-0) | 0 (0-0) | 0, within noise |
| All processes | 0 (0-0) | 0 (0-0) | 0, within noise |

End of run, PSS with shared libraries (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 177 (177-177) | 184 (179-184) | +7 (+4%) |
| Web process (UI, engine worker, BotGuard) | 460 (333-529) | 521 (368-521) | +62 (+13%), within noise |
| Network process | 13 (13-13) | 13 (13-13) | +0 (+0%), within noise |
| All processes | 650 (524-719) | 713 (565-719) | +63 (+10%), within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 122 (122-123) | 130 (130-131) | +8 (+7%) |
| Web process (UI, engine worker, BotGuard) | 481 (479-503) | 497 (487-517) | +16 (+3%), within noise |
| Network process | 8 (7-8) | 8 (8-8) | +0 (+0%), within noise |
| All processes | 606 (601-631) | 627 (620-651) | +21 (+3%), within noise |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 288 (288-288) | 297 (296-298) | +9 (+3%) |
| Web process (UI, engine worker, BotGuard) | 667 (654-683) | 678 (664-679) | +10 (+2%), within noise |
| Network process | 52 (51-52) | 52 (52-52) | +0 (+0%), within noise |

Threads at end:

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 50 (50-50) | 50 (50-50) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 39 (39-39) | 39 (39-40) | 0 (0%), within noise |
| Network process | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes | 100 (100-100) | 100 (100-101) | 0 (0%), within noise |

All processes, held at the end of each phase (MB):

| Phase | Before | After | Change |
| --- | ---: | ---: | ---: |
| idle | 193 (189-195) | 192 (186-197) | -1 (-0%), within noise |
| browse | 309 (309-322) | 322 (311-327) | +13 (+4%), within noise |
| long-playlist | 336 (331-339) | 347 (331-347) | +10 (+3%) |
| playback | 542 (407-594) | 589 (444-599) | +47 (+9%), within noise |
| idle-end | 553 (417-631) | 617 (474-627) | +64 (+12%), within noise |

`pr4-no-player-script`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E

`pr6-small-maps`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E
