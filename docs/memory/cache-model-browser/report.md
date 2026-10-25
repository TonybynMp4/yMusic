### WebKit cache model DOCUMENT_BROWSER (#61)

Scenario, 3 runs of `main` (bcb8606) and 3 of `cache-model-browser` (1b73af5), on 2026-10-14. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 129 (127-133) | 131 (130-135) | +2 (+2%), within noise |
| Web process (UI, engine worker, BotGuard) | 298 (296-301) | 306 (306-307) | +8 (+3%) |
| Network process | 7 (7-8) | 7 (7-7) | 0 (0%), within noise |
| All processes | 435 (431-441) | 445 (445-449) | +10 (+2%), within noise |

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
| Core (Rust, mpv) | 206 (203-209) | 208 (207-212) | +2 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 380 (378-383) | 388 (388-389) | +8 (+2%) |
| Network process | 15 (15-15) | 15 (15-15) | -0 (-0%), within noise |
| All processes | 601 (596-608) | 612 (612-615) | +10 (+2%), within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 136 (135-142) | 139 (136-140) | +4 (+3%), within noise |
| Web process (UI, engine worker, BotGuard) | 349 (336-353) | 318 (314-318) | -31 (-9%) |
| Network process | 7 (7-8) | 7 (7-8) | 0 (0%), within noise |
| All processes | 442 (442-450) | 456 (452-460) | +15 (+3%) |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 302 (300-307) | 305 (303-306) | +4 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 511 (498-513) | 494 (492-496) | -17 (-3%) |
| Network process | 51 (51-51) | 51 (51-51) | +0 (+0%), within noise |

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
| idle | 147 (147-148) | 148 (147-149) | +1 (+0%), within noise |
| browse | 304 (290-314) | 287 (280-289) | -17 (-5%), within noise |
| long-playlist | 327 (324-329) | 303 (300-315) | -24 (-7%) |
| playback | 420 (416-428) | 431 (431-442) | +11 (+3%), within noise |
| idle-end | 438 (434-445) | 453 (448-456) | +16 (+4%) |
