### Prune small maps

Scenario, 3 runs of `pr4-no-player-script` (2662e3b) and 3 of `pr6-small-maps` (52b3ee3), on 2026-10-10, 2026-10-11. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 126 (123-127) | 127 (126-131) | +1 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 264 (257-292) | 280 (254-296) | +16 (+6%), within noise |
| Network process | 7 (7-8) | 7 (7-8) | +0 (+0%), within noise |
| All processes | 399 (390-423) | 413 (388-434) | +15 (+4%), within noise |

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
| Core (Rust, mpv) | 199 (187-205) | 184 (183-188) | -15 (-8%), within noise |
| Web process (UI, engine worker, BotGuard) | 345 (316-373) | 327 (301-343) | -17 (-5%), within noise |
| Network process | 16 (16-17) | 13 (13-13) | -3 (-18%) |
| All processes | 566 (519-588) | 523 (498-544) | -43 (-8%), within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 128 (128-135) | 135 (130-135) | +7 (+5%) |
| Web process (UI, engine worker, BotGuard) | 320 (318-332) | 314 (301-315) | -6 (-2%), within noise |
| Network process | 7 (7-8) | 7 (7-8) | +0 (+0%), within noise |
| All processes | 418 (414-441) | 441 (401-453) | +23 (+6%), within noise |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 294 (290-301) | 302 (297-302) | +8 (+3%), within noise |
| Web process (UI, engine worker, BotGuard) | 520 (492-526) | 499 (495-525) | -21 (-4%), within noise |
| Network process | 51 (49-51) | 52 (51-52) | +1 (+2%), within noise |

Threads at end:

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 49 (49-49) | 49 (49-49) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 38 (38-38) | 38 (38-38) | 0 (0%), within noise |
| Network process | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes | 98 (98-98) | 98 (98-98) | 0 (0%), within noise |

All processes, held at the end of each phase (MB):

| Phase | Before | After | Change |
| --- | ---: | ---: | ---: |
| idle | 146 (145-147) | 146 (146-147) | +1 (+0%), within noise |
| browse | 310 (305-315) | 299 (298-310) | -11 (-4%) |
| long-playlist | 339 (337-347) | 334 (316-341) | -5 (-2%), within noise |
| playback | 404 (384-407) | 381 (380-419) | -22 (-6%), within noise |
| idle-end | 406 (396-429) | 430 (391-437) | +24 (+6%), within noise |
