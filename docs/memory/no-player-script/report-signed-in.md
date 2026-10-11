### Skipping the player script, signed in

Signed-in scenario, 3 runs of `pr3-browse-lru` (407ce58, a4682f5) and 3 of `pr4-no-player-script` (2662e3b), on 2026-10-10, 2026-10-11. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is PSS plus swap.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 195 (164-210) | 177 (177-177) | -18 (-9%), within noise |
| Web process (UI, engine worker, BotGuard) | 516 (512-570) | 460 (333-529) | -56 (-11%), within noise |
| Network process | 16 (14-18) | 13 (13-13) | -3 (-18%), within noise |
| All processes | 723 (693-797) | 650 (524-719) | -73 (-10%), within noise |

End of run, in RAM (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 195 (136-210) | 177 (177-177) | -18 (-9%), within noise |
| Web process (UI, engine worker, BotGuard) | 512 (387-570) | 460 (333-529) | -52 (-10%), within noise |
| Network process | 16 (7-18) | 13 (13-13) | -3 (-18%), within noise |
| All processes | 723 (531-797) | 650 (524-719) | -73 (-10%), within noise |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-27) | 0 (0-0) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-129) | 0 (0-0) | 0, within noise |
| Network process | 0 (0-6) | 0 (0-0) | 0, within noise |
| All processes | 0 (0-162) | 0 (0-0) | 0, within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 205 (204-211) | 178 (177-178) | -27 (-13%) |
| Web process (UI, engine worker, BotGuard) | 590 (572-609) | 528 (524-550) | -62 (-11%) |
| Network process | 17 (16-18) | 13 (13-13) | -4 (-23%) |
| All processes | 799 (770-834) | 711 (710-740) | -88 (-11%) |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 298 (287-301) | 288 (288-288) | -9 (-3%), within noise |
| Web process (UI, engine worker, BotGuard) | 686 (685-689) | 667 (654-683) | -19 (-3%) |
| Network process | 51 (49-51) | 52 (51-52) | +1 (+1%), within noise |

Threads at end:

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 50 (50-52) | 50 (50-50) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 39 (39-41) | 39 (39-39) | 0 (0%), within noise |
| Network process | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes | 100 (100-104) | 100 (100-100) | 0 (0%), within noise |

All processes, held at the end of each phase (MB):

| Phase | Before | After | Change |
| --- | ---: | ---: | ---: |
| idle | 639 (527-644) | 293 (289-298) | -346 (-54%) |
| browse | 494 (475-503) | 415 (409-427) | -79 (-16%) |
| long-playlist | 511 (491-523) | 437 (436-444) | -74 (-14%) |
| playback | 728 (722-785) | 646 (517-703) | -82 (-11%) |
| idle-end | 732 (692-804) | 661 (526-740) | -72 (-10%), within noise |

`pr3-browse-lru`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E

`pr4-no-player-script`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E
