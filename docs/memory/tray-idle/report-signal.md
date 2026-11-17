### Tell the page it is hidden (main vs feat/tray-idle-signal)

Tray: scenario, 3 runs of `tray-main` (6ab1304) and 3 of `tray-signal` (3ed0db6), on 2026-11-16, 2026-11-17. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s, with the window shown again; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 128 (125-132) | 129 (123-140) | +1 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 177 (175-180) | 175 (175-179) | -1 (-1%), within noise |
| Network process                           |       7 (7-7) |       7 (7-7) |               -0 (-0%) |
| All processes                             | 315 (307-316) | 312 (310-323) | -4 (-1%), within noise |

End of run, in swap (MB):

| Process                                   |   Before |   After |          Change |
| ----------------------------------------- | -------: | ------: | --------------: |
| Core (Rust, mpv)                          | 0 (0-24) | 0 (0-0) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-35) | 0 (0-0) | 0, within noise |
| Network process                           |  0 (0-5) | 0 (0-0) | 0, within noise |
| All processes                             | 0 (0-64) | 0 (0-0) | 0, within noise |

End of run, PSS with shared libraries (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 213 (139-219) | 217 (205-219) | +4 (+2%), within noise |
| Web process (UI, engine worker, BotGuard) | 265 (184-268) | 264 (260-266) | -1 (-1%), within noise |
| Network process                           |     18 (7-18) |    18 (17-18) | -0 (-2%), within noise |
| All processes                             | 499 (330-502) | 495 (489-499) | -4 (-1%), within noise |

Peak, held (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 131 (128-139) | 133 (124-141) | +2 (+2%), within noise |
| Web process (UI, engine worker, BotGuard) | 235 (234-239) | 241 (238-245) |               +7 (+3%) |
| Network process                           |       8 (7-8) |       7 (7-7) | -0 (-0%), within noise |
| All processes                             | 362 (355-364) | 364 (362-370) | +3 (+1%), within noise |

Peak RSS, from `VmHWM` (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 295 (272-305) | 295 (291-301) | +0 (+0%), within noise |
| Web process (UI, engine worker, BotGuard) | 415 (402-415) | 413 (413-416) | -2 (-0%), within noise |
| Network process                           |    51 (49-51) |    51 (51-51) |   0 (0%), within noise |

Threads at end:

| Process                                   |     Before |      After |               Change |
| ----------------------------------------- | ---------: | ---------: | -------------------: |
| Core (Rust, mpv)                          | 49 (49-49) | 49 (49-49) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 29 (29-37) | 29 (29-29) | 0 (0%), within noise |
| Network process                           | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes                             | 89 (89-97) | 89 (89-89) | 0 (0%), within noise |

All processes, held at the end of each phase (MB):

| Phase     |        Before |         After |                 Change |
| --------- | ------------: | ------------: | ---------------------: |
| idle      | 148 (147-149) | 149 (148-149) | +0 (+0%), within noise |
| playback  | 216 (216-216) | 216 (211-218) | -0 (-0%), within noise |
| browse    | 308 (302-311) | 310 (303-317) | +2 (+1%), within noise |
| search    | 311 (303-313) | 310 (298-311) | -2 (-0%), within noise |
| visible   | 295 (291-298) | 305 (298-308) |              +10 (+4%) |
| tray-hide | 307 (300-308) | 304 (301-305) | -3 (-1%), within noise |
| tray-show | 321 (311-321) | 321 (309-327) | +0 (+0%), within noise |

Window open, held (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 115 (115-120) | 117 (116-119) | +3 (+2%), within noise |
| Web process (UI, engine worker, BotGuard) | 173 (170-179) | 184 (174-184) |              +11 (+6%) |
| Network process                           |       7 (7-8) |       7 (7-7) | -0 (-0%), within noise |
| All processes                             | 301 (292-301) | 309 (297-310) | +8 (+3%), within noise |

In the tray, held (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 119 (114-119) | 118 (113-126) | -0 (-0%), within noise |
| Web process (UI, engine worker, BotGuard) | 177 (173-177) | 173 (169-176) | -4 (-2%), within noise |
| Network process                           |       7 (7-8) |       7 (7-7) | -0 (-0%), within noise |
| All processes                             | 303 (294-303) | 299 (297-303) | -4 (-1%), within noise |

Shown again, held (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 128 (125-132) | 129 (123-140) | +1 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 177 (175-180) | 175 (175-179) | -1 (-1%), within noise |
| Network process                           |       7 (7-7) |       7 (7-7) |               -0 (-0%) |
| All processes                             | 315 (307-316) | 312 (310-323) | -4 (-1%), within noise |

Held more with the window shown again than in the tray (MB):

| Process                                   |      Before |       After |                  Change |
| ----------------------------------------- | ----------: | ----------: | ----------------------: |
| Core (Rust, mpv)                          |   11 (9-13) |  10 (10-14) |  -0 (-1%), within noise |
| Web process (UI, engine worker, BotGuard) |     2 (0-3) |     3 (3-6) | +1 (+26%), within noise |
| Network process                           | 0 (-0 to 0) | 0 (-0 to 0) |         0, within noise |
| All processes                             |  13 (12-13) |  13 (13-20) |  +0 (+0%), within noise |

Window open, CPU (% of one core):

| Process                                   |        Before |         After |                    Change |
| ----------------------------------------- | ------------: | ------------: | ------------------------: |
| Core (Rust, mpv)                          | 3.0 (2.9-3.5) | 3.5 (3.4-4.8) | +0.5 (+17%), within noise |
| Web process (UI, engine worker, BotGuard) | 2.1 (2.0-2.7) | 2.5 (2.2-3.5) | +0.4 (+21%), within noise |
| Network process                           | 0.0 (0.0-0.0) | 0.0 (0.0-0.0) |               -0.0 (-33%) |
| All processes                             | 5.1 (4.9-6.2) | 6.0 (5.7-8.3) | +0.9 (+18%), within noise |

In the tray, CPU (% of one core):

| Process                                   |        Before |         After |                   Change |
| ----------------------------------------- | ------------: | ------------: | -----------------------: |
| Core (Rust, mpv)                          | 2.6 (2.3-2.9) | 2.6 (2.6-2.7) | +0.1 (+2%), within noise |
| Web process (UI, engine worker, BotGuard) | 1.6 (1.5-1.8) | 0.5 (0.4-0.5) |              -1.1 (-69%) |
| Network process                           | 0.0 (0.0-0.0) | 0.0 (0.0-0.0) |              -0.0 (-81%) |
| All processes                             | 4.2 (3.9-4.7) | 3.2 (3.0-3.2) |              -1.1 (-26%) |

Shown again, CPU (% of one core):

| Process                                   |        Before |         After |                    Change |
| ----------------------------------------- | ------------: | ------------: | ------------------------: |
| Core (Rust, mpv)                          | 3.4 (2.9-4.8) | 4.8 (3.4-5.1) | +1.4 (+42%), within noise |
| Web process (UI, engine worker, BotGuard) | 2.8 (1.9-3.2) | 2.8 (2.3-2.9) |  +0.0 (+1%), within noise |
| Network process                           | 0.1 (0.0-0.1) | 0.1 (0.0-0.1) |  -0.0 (-0%), within noise |
| All processes                             | 6.6 (4.9-7.6) | 7.7 (5.7-7.9) | +1.1 (+17%), within noise |

Window open, wakeups per second:

| Process                                   |        Before |         After |                   Change |
| ----------------------------------------- | ------------: | ------------: | -----------------------: |
| Core (Rust, mpv)                          | 282 (277-287) | 281 (278-318) |   -2 (-1%), within noise |
| Web process (UI, engine worker, BotGuard) |   90 (82-105) | 108 (102-166) | +18 (+20%), within noise |
| Network process                           |       8 (7-8) |       7 (7-8) |   -0 (-2%), within noise |
| All processes                             | 375 (372-400) | 396 (388-491) |  +21 (+6%), within noise |

In the tray, wakeups per second:

| Process                                   |        Before |         After |     Change |
| ----------------------------------------- | ------------: | ------------: | ---------: |
| Core (Rust, mpv)                          | 237 (236-244) | 222 (220-223) |  -15 (-6%) |
| Web process (UI, engine worker, BotGuard) |    66 (63-80) |    12 (11-16) | -53 (-81%) |
| Network process                           |       8 (7-8) |       1 (1-1) |  -6 (-83%) |
| All processes                             | 310 (307-331) | 236 (235-238) | -74 (-24%) |

Shown again, wakeups per second:

| Process                                   |        Before |         After |                   Change |
| ----------------------------------------- | ------------: | ------------: | -----------------------: |
| Core (Rust, mpv)                          | 283 (277-316) | 306 (276-319) |  +23 (+8%), within noise |
| Web process (UI, engine worker, BotGuard) |  137 (83-239) |  105 (64-125) | -32 (-23%), within noise |
| Network process                           |       7 (7-8) |       7 (7-7) |                 -0 (-6%) |
| All processes                             | 460 (373-523) | 418 (348-451) |  -42 (-9%), within noise |

`tray-main`: songs found playing in the tray, per run: 6, 6, 6

`tray-signal`: songs found playing in the tray, per run: 6, 6, 6
