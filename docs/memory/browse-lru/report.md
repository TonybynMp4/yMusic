### Browse page cache capped at 10

Scenario, 3 runs of `pr2-arenas` (ef3e7db, 6640884) and 3 of `pr3-browse-lru` (407ce58), on 2026-10-09, 2026-10-10. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is PSS plus swap.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 203 (180-206) | 197 (194-204) | -7 (-3%), within noise |
| Web process (UI, engine worker, BotGuard) | 553 (389-617) | 380 (378-388) | -173 (-31%), within noise |
| Network process | 17 (14-17) | 16 (16-17) | -1 (-4%), within noise |
| All processes | 773 (612-811) | 598 (593-599) | -175 (-23%), within noise |

End of run, in RAM (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 203 (152-206) | 197 (194-204) | -7 (-3%), within noise |
| Web process (UI, engine worker, BotGuard) | 398 (389-553) | 380 (378-388) | -18 (-5%), within noise |
| Network process | 17 (8-17) | 16 (16-17) | -1 (-4%), within noise |
| All processes | 612 (559-773) | 598 (593-599) | -14 (-2%), within noise |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-28) | 0 (0-0) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-218) | 0 (0-0) | 0, within noise |
| Network process | 0 (0-6) | 0 (0-0) | 0, within noise |
| All processes | 0 (0-252) | 0 (0-0) | 0, within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 210 (188-212) | 207 (196-216) | -4 (-2%), within noise |
| Web process (UI, engine worker, BotGuard) | 564 (558-639) | 596 (545-600) | +33 (+6%), within noise |
| Network process | 17 (17-17) | 16 (16-17) | -1 (-3%) |
| All processes | 784 (733-833) | 756 (751-773) | -28 (-4%), within noise |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 297 (281-297) | 295 (290-307) | -2 (-1%), within noise |
| Web process (UI, engine worker, BotGuard) | 691 (672-707) | 713 (648-719) | +22 (+3%), within noise |
| Network process | 50 (50-51) | 51 (50-51) | +1 (+1%), within noise |

Threads at end:

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 49 (49-49) | 49 (49-49) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 39 (38-39) | 38 (38-39) | -1 (-3%), within noise |
| Network process | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes | 99 (98-99) | 98 (98-99) | -1 (-1%), within noise |

All processes, held at the end of each phase (MB):

| Phase | Before | After | Change |
| --- | ---: | ---: | ---: |
| idle | 295 (294-296) | 286 (278-298) | -9 (-3%) |
| browse | 460 (455-471) | 466 (462-773) | +6 (+1%), within noise |
| long-playlist | 491 (485-499) | 495 (475-738) | +4 (+1%), within noise |
| playback | 757 (598-772) | 584 (575-606) | -173 (-23%), within noise |
| idle-end | 776 (616-817) | 602 (578-604) | -175 (-22%), within noise |
