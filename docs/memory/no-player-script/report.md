### Skipping the player script, signed out

Scenario, 3 runs of `pr3-browse-lru` (407ce58) and 3 of `pr4-no-player-script` (2662e3b), on 2026-10-10. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is PSS plus swap.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 197 (194-204) | 199 (187-205) | +2 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 380 (378-388) | 345 (316-373) | -36 (-9%) |
| Network process | 16 (16-17) | 16 (16-17) | -0 (-1%), within noise |
| All processes | 598 (593-599) | 566 (519-588) | -32 (-5%) |

End of run, in RAM (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 197 (194-204) | 199 (187-205) | +2 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 380 (378-388) | 345 (316-373) | -36 (-9%) |
| Network process | 16 (16-17) | 16 (16-17) | -0 (-1%), within noise |
| All processes | 598 (593-599) | 566 (519-588) | -32 (-5%) |

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
| Core (Rust, mpv) | 207 (196-216) | 204 (192-213) | -3 (-2%), within noise |
| Web process (UI, engine worker, BotGuard) | 596 (545-600) | 401 (384-414) | -195 (-33%) |
| Network process | 16 (16-17) | 16 (16-17) | -0 (-1%), within noise |
| All processes | 756 (751-773) | 585 (551-606) | -171 (-23%) |

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
| idle | 286 (278-298) | 297 (274-299) | +11 (+4%), within noise |
| browse | 466 (462-773) | 459 (446-468) | -7 (-1%), within noise |
| long-playlist | 495 (475-738) | 495 (471-502) | -0 (-0%), within noise |
| playback | 584 (575-606) | 551 (544-564) | -33 (-6%) |
| idle-end | 602 (578-604) | 573 (520-594) | -29 (-5%) |
