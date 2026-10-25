### Skipping the player script, signed in

Signed-in scenario, 3 runs of `pr3-browse-lru` (407ce58, a4682f5) and 3 of `pr4-no-player-script` (2662e3b), on 2026-10-10, 2026-10-11. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 125 (124-127) | 121 (121-121) | -4 (-3%) |
| Web process (UI, engine worker, BotGuard) | 473 (442-486) | 413 (286-481) | -59 (-13%) |
| Network process | 8 (7-8) | 7 (7-7) | -0 (-0%), within noise |
| All processes | 607 (573-618) | 542 (414-610) | -65 (-11%) |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-27) | 0 (0-0) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-129) | 0 (0-0) | 0, within noise |
| Network process | 0 (0-6) | 0 (0-0) | 0, within noise |
| All processes | 0 (0-162) | 0 (0-0) | 0, within noise |

End of run, PSS with shared libraries (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 195 (136-210) | 177 (177-177) | -18 (-9%), within noise |
| Web process (UI, engine worker, BotGuard) | 512 (387-570) | 460 (333-529) | -52 (-10%), within noise |
| Network process | 16 (7-18) | 13 (13-13) | -3 (-18%), within noise |
| All processes | 723 (531-797) | 650 (524-719) | -73 (-10%), within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 134 (125-136) | 122 (122-123) | -12 (-9%) |
| Web process (UI, engine worker, BotGuard) | 513 (502-526) | 481 (479-503) | -32 (-6%) |
| Network process | 8 (8-8) | 8 (7-8) | -0 (-0%), within noise |
| All processes | 648 (621-655) | 606 (601-631) | -42 (-6%) |

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
| idle | 471 (391-472) | 193 (189-195) | -278 (-59%) |
| browse | 328 (328-346) | 309 (309-322) | -19 (-6%) |
| long-playlist | 348 (344-363) | 336 (331-339) | -11 (-3%), within noise |
| playback | 586 (572-606) | 542 (407-594) | -44 (-7%) |
| idle-end | 625 (583-627) | 553 (417-631) | -72 (-12%) |

`pr3-browse-lru`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E

`pr4-no-player-script`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E
