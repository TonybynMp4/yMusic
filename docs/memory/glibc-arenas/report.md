### Cap glibc arenas

Scenario, 3 runs of `main` (56f1a7d+dirty) and 3 of `pr2-arenas` (ef3e7db, 6640884), on 2026-10-09. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 181 (180-187) | 127 (127-131) | -54 (-30%) |
| Web process (UI, engine worker, BotGuard) | 317 (277-335) | 477 (314-566) | +160 (+51%) |
| Network process | 8 (8-8) | 7 (7-7) | -0 (-1%) |
| All processes | 511 (465-524) | 611 (453-700) | +100 (+20%) |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-0) | 0 (0-28) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-0) | 0 (0-218) | 0, within noise |
| Network process | 0 (0-0) | 0 (0-6) | 0, within noise |
| All processes | 0 (0-0) | 0 (0-252) | 0, within noise |

End of run, PSS with shared libraries (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 267 (267-273) | 203 (152-206) | -64 (-24%) |
| Web process (UI, engine worker, BotGuard) | 405 (365-423) | 398 (389-553) | -7 (-2%), within noise |
| Network process | 16 (16-16) | 17 (8-17) | +1 (+5%) |
| All processes | 694 (647-706) | 612 (559-773) | -82 (-12%) |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 187 (180-190) | 135 (133-137) | -52 (-28%) |
| Web process (UI, engine worker, BotGuard) | 456 (430-481) | 487 (483-588) | +31 (+7%), within noise |
| Network process | 8 (8-8) | 7 (7-7) | -0 (-1%) |
| All processes | 628 (592-630) | 622 (576-722) | -6 (-1%), within noise |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 351 (347-358) | 297 (281-297) | -54 (-15%) |
| Web process (UI, engine worker, BotGuard) | 693 (666-707) | 691 (672-707) | -2 (-0%), within noise |
| Network process | 51 (50-51) | 50 (50-51) | -1 (-2%) |

Threads at end:

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 49 (49-49) | 49 (49-49) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 38 (38-40) | 39 (38-39) | +1 (+3%), within noise |
| Network process | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes | 98 (98-100) | 99 (98-99) | +1 (+1%), within noise |

All processes, held at the end of each phase (MB):

| Phase | Before | After | Change |
| --- | ---: | ---: | ---: |
| idle | 148 (147-148) | 146 (146-147) | -1 (-1%) |
| browse | 337 (330-358) | 308 (301-316) | -29 (-9%) |
| long-playlist | 360 (359-391) | 339 (330-344) | -21 (-6%), within noise |
| playback | 494 (454-510) | 595 (438-661) | +101 (+20%) |
| idle-end | 516 (473-524) | 616 (456-707) | +101 (+20%) |
