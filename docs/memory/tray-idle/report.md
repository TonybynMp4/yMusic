### In the tray, on main

Tray: scenario, 3 runs of `tray-main` (6ab1304) on 2026-11-16, 2026-11-17. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s, with the window shown again; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

| Process                                   |     End, held | End, in swap |      End, PSS |    Peak, held |      Peak RSS | Threads at end |
| ----------------------------------------- | ------------: | -----------: | ------------: | ------------: | ------------: | -------------: |
| Core (Rust, mpv)                          | 128 (125-132) |     0 (0-24) | 213 (139-219) | 131 (128-139) | 295 (272-305) |     49 (49-49) |
| Web process (UI, engine worker, BotGuard) | 177 (175-180) |     0 (0-35) | 265 (184-268) | 235 (234-239) | 415 (402-415) |     29 (29-37) |
| Network process                           |       7 (7-7) |      0 (0-5) |     18 (7-18) |       8 (7-8) |    51 (49-51) |     11 (11-11) |
| All processes                             | 315 (307-316) |     0 (0-64) | 499 (330-502) | 362 (355-364) |               |     89 (89-97) |

All processes, held at the end of each phase (MB):

| Phase     |          Held |
| --------- | ------------: |
| idle      | 148 (147-149) |
| playback  | 216 (216-216) |
| browse    | 308 (302-311) |
| search    | 311 (303-313) |
| visible   | 295 (291-298) |
| tray-hide | 307 (300-308) |
| tray-show | 321 (311-321) |

Held in each stretch (MB), as the mean over its last 60 s. The last column is shown again minus in the tray:

| Process                                   |   Window open |   In the tray |   Shown again | Shown again, change |
| ----------------------------------------- | ------------: | ------------: | ------------: | ------------------: |
| Core (Rust, mpv)                          | 115 (115-120) | 119 (114-119) | 128 (125-132) |           11 (9-13) |
| Web process (UI, engine worker, BotGuard) | 173 (170-179) | 177 (173-177) | 177 (175-180) |             2 (0-3) |
| Network process                           |       7 (7-8) |       7 (7-8) |       7 (7-7) |         0 (-0 to 0) |
| All processes                             | 301 (292-301) | 303 (294-303) | 315 (307-316) |          13 (12-13) |

CPU over each whole stretch, as a share of one core (%): user plus system time from `/proc/<pid>/stat`.

| Process                                   |   Window open |   In the tray |   Shown again |
| ----------------------------------------- | ------------: | ------------: | ------------: |
| Core (Rust, mpv)                          | 3.0 (2.9-3.5) | 2.6 (2.3-2.9) | 3.4 (2.9-4.8) |
| Web process (UI, engine worker, BotGuard) | 2.1 (2.0-2.7) | 1.6 (1.5-1.8) | 2.8 (1.9-3.2) |
| Network process                           | 0.0 (0.0-0.0) | 0.0 (0.0-0.0) | 0.1 (0.0-0.1) |
| All processes                             | 5.1 (4.9-6.2) | 4.2 (3.9-4.7) | 6.6 (4.9-7.6) |

Wakeups per second over each whole stretch: how often the process's threads were put on a CPU.

| Process                                   |   Window open |   In the tray |   Shown again |
| ----------------------------------------- | ------------: | ------------: | ------------: |
| Core (Rust, mpv)                          | 282 (277-287) | 237 (236-244) | 283 (277-316) |
| Web process (UI, engine worker, BotGuard) |   90 (82-105) |    66 (63-80) |  137 (83-239) |
| Network process                           |       8 (7-8) |       8 (7-8) |       7 (7-8) |
| All processes                             | 375 (372-400) | 310 (307-331) | 460 (373-523) |

`tray-main`: songs found playing in the tray, per run: 6, 6, 6
