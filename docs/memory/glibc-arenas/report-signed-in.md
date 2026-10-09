### Cap glibc arenas, signed in

Signed-in scenario, 3 runs of `main` (2815d06+dirty) and 3 of `pr2-arenas` (6640884), on 2026-10-09. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is PSS plus swap.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 278 (237-285) | 208 (185-212) | -70 (-25%) |
| Web process (UI, engine worker, BotGuard) | 412 (319-520) | 413 (408-466) | +1 (+0%), within noise |
| Network process | 17 (14-17) | 18 (18-18) | +0 (+1%), within noise |
| All processes | 715 (571-815) | 643 (633-669) | -71 (-10%), within noise |

End of run, in RAM (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 278 (192-285) | 208 (185-212) | -70 (-25%), within noise |
| Web process (UI, engine worker, BotGuard) | 412 (255-520) | 413 (408-466) | +1 (+0%), within noise |
| Network process | 17 (7-17) | 18 (18-18) | +0 (+1%), within noise |
| All processes | 715 (454-815) | 643 (633-669) | -71 (-10%), within noise |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-45) | 0 (0-0) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-64) | 0 (0-0) | 0, within noise |
| Network process | 0 (0-7) | 0 (0-0) | 0, within noise |
| All processes | 0 (0-116) | 0 (0-0) | 0, within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 278 (270-285) | 214 (194-224) | -64 (-23%) |
| Web process (UI, engine worker, BotGuard) | 621 (610-645) | 595 (591-620) | -26 (-4%), within noise |
| Network process | 17 (17-17) | 18 (18-18) | +0 (+1%) |
| All processes | 885 (880-906) | 791 (775-805) | -94 (-11%) |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 359 (351-366) | 294 (274-303) | -66 (-18%) |
| Web process (UI, engine worker, BotGuard) | 712 (685-719) | 694 (688-736) | -18 (-3%), within noise |
| Network process | 51 (51-51) | 51 (51-51) | -1 (-1%) |

Threads at end:

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 50 (50-50) | 50 (49-50) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 39 (39-39) | 39 (39-39) | 0 (0%), within noise |
| Network process | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes | 100 (100-100) | 100 (99-100) | 0 (0%), within noise |

All processes, held at the end of each phase (MB):

| Phase | Before | After | Change |
| --- | ---: | ---: | ---: |
| idle | 609 (603-612) | 599 (595-764) | -10 (-2%) |
| browse | 540 (533-548) | 501 (499-514) | -38 (-7%) |
| long-playlist | 552 (548-574) | 531 (531-535) | -21 (-4%), within noise |
| playback | 697 (635-809) | 628 (620-649) | -69 (-10%), within noise |
| idle-end | 717 (554-818) | 665 (648-688) | -53 (-7%), within noise |

`main`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E

`pr2-arenas`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; warnings in the app log per run: 0, 0, 21
