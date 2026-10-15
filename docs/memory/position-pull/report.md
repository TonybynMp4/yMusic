### Pull the playback position (#59 vs this PR)

Scenario, 3 runs of `pr6-small-maps` (52b3ee3) and 3 of `pull` (4d18e7e), on 2026-10-11, 2026-10-12. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 127 (126-131) | 128 (125-132) | +1 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 280 (254-296) | 199 (198-203) | -81 (-29%) |
| Network process | 7 (7-8) | 7 (7-7) | -0 (-0%), within noise |
| All processes | 413 (388-434) | 338 (331-338) | -75 (-18%) |

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
| Core (Rust, mpv) | 184 (183-188) | 199 (197-205) | +15 (+8%) |
| Web process (UI, engine worker, BotGuard) | 327 (301-343) | 278 (278-282) | -49 (-15%) |
| Network process | 13 (13-13) | 17 (17-17) | +4 (+30%) |
| All processes | 523 (498-544) | 498 (492-500) | -25 (-5%), within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 135 (130-135) | 136 (132-136) | +1 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 314 (301-315) | 316 (310-335) | +2 (+1%), within noise |
| Network process | 7 (7-8) | 8 (7-8) | +0 (+0%), within noise |
| All processes | 441 (401-453) | 398 (387-406) | -43 (-10%), within noise |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 302 (297-302) | 302 (300-303) | -0 (-0%), within noise |
| Web process (UI, engine worker, BotGuard) | 499 (495-525) | 499 (498-503) | +0 (+0%), within noise |
| Network process | 52 (51-52) | 51 (50-51) | -0 (-0%), within noise |

Threads at end:

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 49 (49-49) | 49 (49-49) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 38 (38-38) | 38 (37-39) | 0 (0%), within noise |
| Network process | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes | 98 (98-98) | 98 (97-99) | 0 (0%), within noise |

All processes, held at the end of each phase (MB):

| Phase | Before | After | Change |
| --- | ---: | ---: | ---: |
| idle | 146 (146-147) | 146 (145-147) | -0 (-0%), within noise |
| browse | 299 (298-310) | 311 (297-328) | +12 (+4%) |
| long-playlist | 334 (316-341) | 341 (330-355) | +7 (+2%), within noise |
| playback | 381 (380-419) | 344 (337-345) | -38 (-10%), within noise |
| idle-end | 430 (391-437) | 334 (330-338) | -95 (-22%) |
