### Cap glibc arenas

Scenario, 3 runs of `main` (56f1a7d+dirty) and 3 of `pr2-arenas` (ef3e7db, 6640884), on 2026-10-09. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is PSS plus swap.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 267 (267-273) | 203 (180-206) | -64 (-24%) |
| Web process (UI, engine worker, BotGuard) | 405 (365-423) | 553 (389-617) | +148 (+36%) |
| Network process | 16 (16-16) | 17 (14-17) | +1 (+5%) |
| All processes | 694 (647-706) | 773 (612-811) | +80 (+11%) |

End of run, in RAM (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 267 (267-273) | 203 (152-206) | -64 (-24%) |
| Web process (UI, engine worker, BotGuard) | 405 (365-423) | 398 (389-553) | -7 (-2%), within noise |
| Network process | 16 (16-16) | 17 (8-17) | +1 (+5%) |
| All processes | 694 (647-706) | 612 (559-773) | -82 (-12%) |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-0) | 0 (0-28) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-0) | 0 (0-218) | 0, within noise |
| Network process | 0 (0-0) | 0 (0-6) | 0, within noise |
| All processes | 0 (0-0) | 0 (0-252) | 0, within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 273 (267-276) | 210 (188-212) | -62 (-23%) |
| Web process (UI, engine worker, BotGuard) | 543 (519-570) | 564 (558-639) | +21 (+4%), within noise |
| Network process | 16 (16-16) | 17 (17-17) | +1 (+5%) |
| All processes | 811 (776-811) | 784 (733-833) | -26 (-3%), within noise |

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
| idle | 317 (317-319) | 295 (294-296) | -23 (-7%) |
| browse | 513 (506-533) | 460 (455-471) | -53 (-10%) |
| long-playlist | 536 (536-566) | 491 (485-499) | -45 (-8%) |
| playback | 677 (636-693) | 757 (598-772) | +80 (+12%) |
| idle-end | 698 (656-705) | 776 (616-817) | +78 (+11%) |
