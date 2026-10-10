### Browse page cache capped at 10, signed in

Signed-in scenario, 3 runs of `pr2-arenas` (6640884) and 3 of `pr3-browse-lru` (407ce58), on 2026-10-09, 2026-10-10. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is PSS plus swap.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 208 (185-212) | 195 (188-197) | -13 (-6%), within noise |
| Web process (UI, engine worker, BotGuard) | 413 (408-466) | 343 (343-512) | -70 (-17%) |
| Network process | 18 (18-18) | 16 (16-16) | -2 (-9%) |
| All processes | 643 (633-669) | 556 (547-723) | -87 (-14%) |

End of run, in RAM (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 208 (185-212) | 195 (188-197) | -13 (-6%), within noise |
| Web process (UI, engine worker, BotGuard) | 413 (408-466) | 343 (343-512) | -70 (-17%) |
| Network process | 18 (18-18) | 16 (16-16) | -2 (-9%) |
| All processes | 643 (633-669) | 556 (547-723) | -87 (-14%) |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-0) | 0 (0-0) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-0) | 0 (0-0) | 0, within noise |
| Network process | 0 (0-0) | 0 (0-0) | 0, within noise |
| All processes | 0 (0-0) | 0 (0-0) | 0, within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 214 (194-224) | 199 (198-204) | -14 (-7%), within noise |
| Web process (UI, engine worker, BotGuard) | 595 (591-620) | 562 (536-572) | -33 (-6%) |
| Network process | 18 (18-18) | 16 (16-16) | -1 (-7%) |
| All processes | 791 (775-805) | 739 (728-770) | -53 (-7%) |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 294 (274-303) | 300 (294-301) | +7 (+2%), within noise |
| Web process (UI, engine worker, BotGuard) | 694 (688-736) | 665 (654-685) | -28 (-4%), within noise |
| Network process | 51 (51-51) | 51 (51-51) | +0 (+0%) |

Threads at end:

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 50 (49-50) | 50 (50-52) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 39 (39-39) | 38 (38-41) | -1 (-3%) |
| Network process | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes | 100 (99-100) | 99 (99-104) | -1 (-1%), within noise |

All processes, held at the end of each phase (MB):

| Phase | Before | After | Change |
| --- | ---: | ---: | ---: |
| idle | 599 (595-764) | 283 (281-527) | -316 (-53%) |
| browse | 501 (499-514) | 442 (428-494) | -59 (-12%) |
| long-playlist | 531 (531-535) | 484 (457-511) | -47 (-9%) |
| playback | 628 (620-649) | 570 (546-722) | -59 (-9%) |
| idle-end | 665 (648-688) | 559 (544-732) | -106 (-16%) |

`pr2-arenas`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; warnings in the app log per run: 0, 0, 21

`pr3-browse-lru`: stall yt:syNLBJ_Lq9E; account signed-out; account signed-out; warnings in the app log per run: 0, 1, 1
