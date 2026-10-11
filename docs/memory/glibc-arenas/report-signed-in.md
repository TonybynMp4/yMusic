### Cap glibc arenas, signed in

Signed-in scenario, 3 runs of `main` (2815d06+dirty) and 3 of `pr2-arenas` (6640884, 92d8c3b), on 2026-10-09, 2026-10-11. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 194 (186-202) | 127 (124-128) | -67 (-35%) |
| Web process (UI, engine worker, BotGuard) | 326 (277-436) | 330 (326-332) | +5 (+1%), within noise |
| Network process | 8 (8-8) | 8 (7-8) | -0 (-1%) |
| All processes | 535 (471-638) | 466 (457-466) | -69 (-13%), within noise |

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
| Core (Rust, mpv) | 278 (192-285) | 208 (184-212) | -70 (-25%), within noise |
| Web process (UI, engine worker, BotGuard) | 412 (255-520) | 408 (379-413) | -4 (-1%), within noise |
| Network process | 17 (7-17) | 18 (13-18) | +0 (+1%), within noise |
| All processes | 715 (454-815) | 633 (577-643) | -81 (-11%), within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 194 (187-202) | 133 (129-139) | -61 (-31%) |
| Web process (UI, engine worker, BotGuard) | 536 (524-558) | 514 (509-515) | -22 (-4%), within noise |
| Network process | 8 (8-8) | 8 (7-8) | -0 (-1%) |
| All processes | 707 (700-727) | 629 (599-646) | -78 (-11%) |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 359 (351-366) | 299 (294-303) | -60 (-17%) |
| Web process (UI, engine worker, BotGuard) | 712 (685-719) | 694 (688-705) | -18 (-3%), within noise |
| Network process | 51 (51-51) | 51 (51-52) | -1 (-1%) |

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
| idle | 437 (428-438) | 424 (369-428) | -14 (-3%) |
| browse | 364 (359-373) | 329 (326-522) | -35 (-10%) |
| long-playlist | 376 (374-398) | 362 (359-573) | -13 (-4%), within noise |
| playback | 518 (458-632) | 451 (444-454) | -67 (-13%), within noise |
| idle-end | 538 (477-641) | 472 (472-487) | -66 (-12%), within noise |

`main`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E

`pr2-arenas`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E
