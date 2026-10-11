### Browse page cache capped at 10

Scenario, 3 runs of `pr2-arenas` (ef3e7db, 6640884) and 3 of `pr3-browse-lru` (407ce58), on 2026-10-09, 2026-10-10. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 127 (127-131) | 131 (126-135) | +3 (+3%), within noise |
| Web process (UI, engine worker, BotGuard) | 477 (314-566) | 310 (302-313) | -167 (-35%), within noise |
| Network process | 7 (7-7) | 7 (7-8) | +0 (+0%), within noise |
| All processes | 611 (453-700) | 446 (445-448) | -165 (-27%), within noise |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-28) | 0 (0-0) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-218) | 0 (0-0) | 0, within noise |
| Network process | 0 (0-6) | 0 (0-0) | 0, within noise |
| All processes | 0 (0-252) | 0 (0-0) | 0, within noise |

End of run, PSS with shared libraries (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 203 (152-206) | 197 (194-204) | -7 (-3%), within noise |
| Web process (UI, engine worker, BotGuard) | 398 (389-553) | 380 (378-388) | -18 (-5%), within noise |
| Network process | 17 (8-17) | 16 (16-17) | -1 (-4%), within noise |
| All processes | 612 (559-773) | 598 (593-599) | -14 (-2%), within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 135 (133-137) | 135 (127-141) | +0 (+0%), within noise |
| Web process (UI, engine worker, BotGuard) | 487 (483-588) | 522 (466-529) | +35 (+7%), within noise |
| Network process | 7 (7-7) | 7 (7-8) | +0 (+0%), within noise |
| All processes | 622 (576-722) | 603 (588-634) | -18 (-3%), within noise |

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
| idle | 146 (146-147) | 144 (144-145) | -2 (-2%) |
| browse | 308 (301-316) | 314 (301-634) | +6 (+2%), within noise |
| long-playlist | 339 (330-344) | 330 (327-594) | -9 (-3%), within noise |
| playback | 595 (438-661) | 431 (431-438) | -164 (-28%), within noise |
| idle-end | 616 (456-707) | 447 (423-451) | -170 (-28%), within noise |
