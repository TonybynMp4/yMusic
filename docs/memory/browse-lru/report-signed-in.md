### Browse page cache capped at 10, signed in

Signed-in scenario, 3 runs of `pr2-arenas` (6640884, 92d8c3b) and 3 of `pr3-browse-lru` (407ce58, a4682f5), on 2026-10-09, 2026-10-11, 2026-10-10. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 127 (124-128) | 125 (124-127) | -2 (-2%), within noise |
| Web process (UI, engine worker, BotGuard) | 330 (326-332) | 473 (442-486) | +142 (+43%) |
| Network process | 8 (7-8) | 8 (7-8) | 0 (0%), within noise |
| All processes | 466 (457-466) | 607 (573-618) | +141 (+30%) |

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
| Core (Rust, mpv) | 208 (184-212) | 195 (136-210) | -13 (-6%), within noise |
| Web process (UI, engine worker, BotGuard) | 408 (379-413) | 512 (387-570) | +104 (+26%) |
| Network process | 18 (13-18) | 16 (7-18) | -1 (-9%), within noise |
| All processes | 633 (577-643) | 723 (531-797) | +89 (+14%) |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 133 (129-139) | 134 (125-136) | +1 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 514 (509-515) | 513 (502-526) | -1 (-0%), within noise |
| Network process | 8 (7-8) | 8 (8-8) | +0 (+0%), within noise |
| All processes | 629 (599-646) | 648 (621-655) | +19 (+3%), within noise |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 299 (294-303) | 298 (287-301) | -2 (-1%), within noise |
| Web process (UI, engine worker, BotGuard) | 694 (688-705) | 686 (685-689) | -7 (-1%), within noise |
| Network process | 51 (51-52) | 51 (49-51) | -0 (-0%), within noise |

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
| idle | 424 (369-428) | 471 (391-472) | +47 (+11%), within noise |
| browse | 329 (326-522) | 328 (328-346) | -1 (-0%), within noise |
| long-playlist | 362 (359-573) | 348 (344-363) | -14 (-4%), within noise |
| playback | 451 (444-454) | 586 (572-606) | +135 (+30%) |
| idle-end | 472 (472-487) | 625 (583-627) | +153 (+33%) |

`pr2-arenas`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E

`pr3-browse-lru`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E
