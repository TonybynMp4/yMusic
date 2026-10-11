### WebKit cache model

Scenario, 3 runs of `pr6-small-maps` (52b3ee3) and 3 of `cachemodel` (5b6607d+dirty), on 2026-10-11. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 127 (126-131) | 131 (120-131) | +4 (+3%), within noise |
| Web process (UI, engine worker, BotGuard) | 280 (254-296) | 272 (234-281) | -8 (-3%), within noise |
| Network process | 7 (7-8) | 8 (8-8) | +0 (+0%), within noise |
| All processes | 413 (388-434) | 399 (373-419) | -14 (-3%), within noise |

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
| Core (Rust, mpv) | 184 (183-188) | 212 (200-213) | +28 (+15%) |
| Web process (UI, engine worker, BotGuard) | 327 (301-343) | 345 (307-353) | +18 (+5%), within noise |
| Network process | 13 (13-13) | 16 (16-16) | +2 (+17%) |
| All processes | 523 (498-544) | 560 (536-581) | +37 (+7%), within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 135 (130-135) | 133 (121-143) | -2 (-2%), within noise |
| Web process (UI, engine worker, BotGuard) | 314 (301-315) | 300 (284-336) | -14 (-4%), within noise |
| Network process | 7 (7-8) | 8 (8-8) | +0 (+0%), within noise |
| All processes | 441 (401-453) | 427 (402-447) | -14 (-3%), within noise |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 302 (297-302) | 300 (288-309) | -1 (-0%), within noise |
| Web process (UI, engine worker, BotGuard) | 499 (495-525) | 488 (478-499) | -11 (-2%), within noise |
| Network process | 52 (51-52) | 52 (52-52) | +0 (+0%), within noise |

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
| idle | 146 (146-147) | 146 (145-146) | -0 (-0%), within noise |
| browse | 299 (298-310) | 259 (253-261) | -40 (-13%) |
| long-playlist | 334 (316-341) | 282 (262-290) | -52 (-15%) |
| playback | 381 (380-419) | 383 (353-400) | +2 (+0%), within noise |
| idle-end | 430 (391-437) | 404 (381-424) | -26 (-6%), within noise |

`cachemodel`: warnings in the app log per run: 59, 52, 59
