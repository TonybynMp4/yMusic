### Cap glibc arenas, signed in

Signed-in scenario, 3 runs of `main` (2815d06+dirty) and 2 of `pr2-arenas` (6640884), on 2026-10-09. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 194 (186-202) | 126 (124-128) | -69 (-35%) |
| Web process (UI, engine worker, BotGuard) | 326 (277-436) | 328 (326-330) | +2 (+1%), within noise |
| Network process | 8 (8-8) | 8 (8-8) | -0 (-1%) |
| All processes | 535 (471-638) | 461 (457-466) | -74 (-14%), within noise |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-45) | 0 (0-0) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-64) | 0 (0-0) | 0, within noise |
| Network process | 0 (0-7) | 0 (0-0) | 0, within noise |
| All processes | 0 (0-116) | 0 (0-0) | 0, within noise |

End of run, PSS with shared libraries (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 278 (192-285) | 210 (208-212) | -67 (-24%), within noise |
| Web process (UI, engine worker, BotGuard) | 412 (255-520) | 411 (408-413) | -1 (-0%), within noise |
| Network process | 17 (7-17) | 18 (18-18) | +0 (+1%), within noise |
| All processes | 715 (454-815) | 638 (633-643) | -76 (-11%), within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 194 (187-202) | 134 (129-139) | -60 (-31%) |
| Web process (UI, engine worker, BotGuard) | 536 (524-558) | 512 (509-514) | -25 (-5%), within noise |
| Network process | 8 (8-8) | 8 (8-8) | -0 (-1%) |
| All processes | 707 (700-727) | 614 (599-629) | -93 (-13%) |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 359 (351-366) | 298 (294-303) | -61 (-17%) |
| Web process (UI, engine worker, BotGuard) | 712 (685-719) | 691 (688-694) | -21 (-3%), within noise |
| Network process | 51 (51-51) | 51 (51-51) | -1 (-1%) |

Threads at end:

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 50 (50-50) | 50 (50-50) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 39 (39-39) | 39 (39-39) | 0 (0%), within noise |
| Network process | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes | 100 (100-100) | 100 (100-100) | 0 (0%), within noise |

All processes, held at the end of each phase (MB):

| Phase | Before | After | Change |
| --- | ---: | ---: | ---: |
| idle | 437 (428-438) | 426 (424-428) | -12 (-3%) |
| browse | 364 (359-373) | 328 (326-329) | -36 (-10%) |
| long-playlist | 376 (374-398) | 360 (359-362) | -15 (-4%), within noise |
| playback | 518 (458-632) | 447 (444-451) | -70 (-14%), within noise |
| idle-end | 538 (477-641) | 479 (472-487) | -58 (-11%), within noise |

`main`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E

`pr2-arenas`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E
