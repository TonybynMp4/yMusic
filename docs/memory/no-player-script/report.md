### Skipping the player script, signed out

Scenario, 3 runs of `pr3-browse-lru` (407ce58) and 3 of `pr4-no-player-script` (2662e3b), on 2026-10-10. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 131 (126-135) | 126 (123-127) | -5 (-4%), within noise |
| Web process (UI, engine worker, BotGuard) | 310 (302-313) | 264 (257-292) | -45 (-15%) |
| Network process | 7 (7-8) | 7 (7-8) | -0 (-0%), within noise |
| All processes | 446 (445-448) | 399 (390-423) | -47 (-11%) |

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
| Core (Rust, mpv) | 197 (194-204) | 199 (187-205) | +2 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 380 (378-388) | 345 (316-373) | -36 (-9%) |
| Network process | 16 (16-17) | 16 (16-17) | -0 (-1%), within noise |
| All processes | 598 (593-599) | 566 (519-588) | -32 (-5%) |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 135 (127-141) | 128 (128-135) | -7 (-5%), within noise |
| Web process (UI, engine worker, BotGuard) | 522 (466-529) | 320 (318-332) | -202 (-39%) |
| Network process | 7 (7-8) | 7 (7-8) | -0 (-0%), within noise |
| All processes | 603 (588-634) | 418 (414-441) | -185 (-31%) |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 295 (290-307) | 294 (290-301) | -1 (-0%), within noise |
| Web process (UI, engine worker, BotGuard) | 713 (648-719) | 520 (492-526) | -193 (-27%) |
| Network process | 51 (50-51) | 51 (49-51) | -0 (-0%), within noise |

Threads at end:

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 49 (49-49) | 49 (49-49) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 38 (38-39) | 38 (38-38) | 0 (0%), within noise |
| Network process | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes | 98 (98-99) | 98 (98-98) | 0 (0%), within noise |

All processes, held at the end of each phase (MB):

| Phase | Before | After | Change |
| --- | ---: | ---: | ---: |
| idle | 144 (144-145) | 146 (145-147) | +1 (+1%) |
| browse | 314 (301-634) | 310 (305-315) | -4 (-1%), within noise |
| long-playlist | 330 (327-594) | 339 (337-347) | +9 (+3%), within noise |
| playback | 431 (431-438) | 404 (384-407) | -27 (-6%) |
| idle-end | 447 (423-451) | 406 (396-429) | -41 (-9%) |
