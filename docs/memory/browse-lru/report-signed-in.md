### Browse page cache capped at 10, signed in

Signed-in scenario, 2 runs of `pr2-arenas` (6640884) and 3 of `pr3-browse-lru` (407ce58, a4682f5), on 2026-10-09, 2026-10-10. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 126 (124-128) | 125 (124-127) | -1 (-1%), within noise |
| Web process (UI, engine worker, BotGuard) | 328 (326-330) | 473 (442-486) | +145 (+44%) |
| Network process | 8 (8-8) | 8 (7-8) | -0 (-0%), within noise |
| All processes | 461 (457-466) | 607 (573-618) | +146 (+32%) |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-0) | 0 (0-27) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-0) | 0 (0-129) | 0, within noise |
| Network process | 0 (0-0) | 0 (0-6) | 0, within noise |
| All processes | 0 (0-0) | 0 (0-162) | 0, within noise |

End of run, PSS with shared libraries (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 210 (208-212) | 195 (136-210) | -15 (-7%) |
| Web process (UI, engine worker, BotGuard) | 411 (408-413) | 512 (387-570) | +101 (+25%) |
| Network process | 18 (18-18) | 16 (7-18) | -2 (-9%) |
| All processes | 638 (633-643) | 723 (531-797) | +84 (+13%) |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 134 (129-139) | 134 (125-136) | +0 (+0%), within noise |
| Web process (UI, engine worker, BotGuard) | 512 (509-514) | 513 (502-526) | +2 (+0%), within noise |
| Network process | 8 (8-8) | 8 (8-8) | +0 (+0%), within noise |
| All processes | 614 (599-629) | 648 (621-655) | +34 (+6%) |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 298 (294-303) | 298 (287-301) | -1 (-0%), within noise |
| Web process (UI, engine worker, BotGuard) | 691 (688-694) | 686 (685-689) | -5 (-1%), within noise |
| Network process | 51 (51-51) | 51 (49-51) | -0 (-0%), within noise |

Threads at end:

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 50 (50-50) | 50 (50-52) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 39 (39-39) | 39 (39-41) | 0 (0%), within noise |
| Network process | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes | 100 (100-100) | 100 (100-104) | 0 (0%), within noise |

All processes, held at the end of each phase (MB):

| Phase | Before | After | Change |
| --- | ---: | ---: | ---: |
| idle | 426 (424-428) | 471 (391-472) | +45 (+11%) |
| browse | 328 (326-329) | 328 (328-346) | +1 (+0%), within noise |
| long-playlist | 360 (359-362) | 348 (344-363) | -12 (-3%) |
| playback | 447 (444-451) | 586 (572-606) | +139 (+31%) |
| idle-end | 479 (472-487) | 625 (583-627) | +146 (+30%) |

`pr2-arenas`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E

`pr3-browse-lru`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E
