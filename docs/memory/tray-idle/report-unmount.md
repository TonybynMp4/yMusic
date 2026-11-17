### Draw nothing and drop page data while hidden (main vs feat/tray-idle-unmount)

Tray: scenario, 3 runs of `tray-main` (6ab1304) and 3 of `tray-unmount` (0c5ffcd), on 2026-11-16, 2026-11-17. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s, with the window shown again; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 128 (125-132) | 129 (121-138) | +1 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 177 (175-180) | 169 (168-169) |               -8 (-4%) |
| Network process                           |       7 (7-7) |       7 (7-7) |               -0 (-0%) |
| All processes                             | 315 (307-316) | 305 (297-315) |              -10 (-3%) |

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
| Core (Rust, mpv)                          | 213 (139-219) | 216 (209-225) | +3 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 265 (184-268) | 258 (256-258) | -7 (-3%), within noise |
| Network process                           |     18 (7-18) |    18 (18-18) | +0 (+1%), within noise |
| All processes                             | 499 (330-502) | 492 (484-501) | -7 (-1%), within noise |

Peak, held (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 131 (128-139) | 130 (123-146) | -1 (-0%), within noise |
| Web process (UI, engine worker, BotGuard) | 235 (234-239) | 249 (239-259) |              +14 (+6%) |
| Network process                           |       8 (7-8) |       7 (7-7) | -0 (-0%), within noise |
| All processes                             | 362 (355-364) | 371 (361-390) |               +9 (+2%) |

Peak RSS, from `VmHWM` (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 295 (272-305) | 297 (289-312) | +2 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 415 (402-415) | 422 (421-425) | +8 (+2%), within noise |
| Network process                           |    51 (49-51) |    51 (51-51) | +0 (+0%), within noise |

Threads at end:

| Process                                   |     Before |      After |               Change |
| ----------------------------------------- | ---------: | ---------: | -------------------: |
| Core (Rust, mpv)                          | 49 (49-49) | 49 (49-49) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 29 (29-37) | 29 (29-30) | 0 (0%), within noise |
| Network process                           | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes                             | 89 (89-97) | 89 (89-90) | 0 (0%), within noise |

All processes, held at the end of each phase (MB):

| Phase     |        Before |         After |                 Change |
| --------- | ------------: | ------------: | ---------------------: |
| idle      | 148 (147-149) | 148 (148-149) | -0 (-0%), within noise |
| playback  | 216 (216-216) | 221 (221-222) |               +5 (+2%) |
| browse    | 308 (302-311) | 318 (312-323) |              +10 (+3%) |
| search    | 311 (303-313) | 316 (309-321) | +5 (+1%), within noise |
| visible   | 295 (291-298) | 301 (296-321) | +6 (+2%), within noise |
| tray-hide | 307 (300-308) | 287 (281-291) |              -20 (-6%) |
| tray-show | 321 (311-321) | 310 (295-319) |              -10 (-3%) |

Window open, held (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 115 (115-120) | 116 (115-122) | +1 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 173 (170-179) | 179 (178-196) | +6 (+3%), within noise |
| Network process                           |       7 (7-8) |       7 (7-7) | -0 (-0%), within noise |
| All processes                             | 301 (292-301) | 309 (300-319) | +8 (+3%), within noise |

In the tray, held (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 119 (114-119) | 118 (112-125) | -0 (-0%), within noise |
| Web process (UI, engine worker, BotGuard) | 177 (173-177) | 156 (154-157) |             -21 (-12%) |
| Network process                           |       7 (7-8) |       7 (7-7) | -0 (-0%), within noise |
| All processes                             | 303 (294-303) | 280 (276-290) |              -23 (-8%) |

Shown again, held (MB):

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 128 (125-132) | 129 (121-138) | +1 (+1%), within noise |
| Web process (UI, engine worker, BotGuard) | 177 (175-180) | 169 (168-169) |               -8 (-4%) |
| Network process                           |       7 (7-7) |       7 (7-7) |               -0 (-0%) |
| All processes                             | 315 (307-316) | 305 (297-315) |              -10 (-3%) |

Held more with the window shown again than in the tray (MB):

| Process                                   |      Before |      After |                 Change |
| ----------------------------------------- | ----------: | ---------: | ---------------------: |
| Core (Rust, mpv)                          |   11 (9-13) |  10 (9-13) | -0 (-1%), within noise |
| Web process (UI, engine worker, BotGuard) |     2 (0-3) | 12 (12-15) |            +10 (+408%) |
| Network process                           | 0 (-0 to 0) |    0 (0-0) |        0, within noise |
| All processes                             |  13 (12-13) | 25 (21-25) |             +12 (+92%) |

Window open, CPU (% of one core):

| Process                                   |        Before |         After |      Change |
| ----------------------------------------- | ------------: | ------------: | ----------: |
| Core (Rust, mpv)                          | 3.0 (2.9-3.5) | 3.8 (3.7-3.8) | +0.8 (+26%) |
| Web process (UI, engine worker, BotGuard) | 2.1 (2.0-2.7) | 2.8 (2.3-3.2) | +0.7 (+35%) |
| Network process                           | 0.0 (0.0-0.0) | 0.0 (0.0-0.0) | -0.0 (-33%) |
| All processes                             | 5.1 (4.9-6.2) | 6.6 (6.1-7.0) | +1.5 (+30%) |

In the tray, CPU (% of one core):

| Process                                   |        Before |         After |                    Change |
| ----------------------------------------- | ------------: | ------------: | ------------------------: |
| Core (Rust, mpv)                          | 2.6 (2.3-2.9) | 2.8 (2.8-2.8) | +0.2 (+10%), within noise |
| Web process (UI, engine worker, BotGuard) | 1.6 (1.5-1.8) | 0.3 (0.3-0.3) |               -1.4 (-84%) |
| Network process                           | 0.0 (0.0-0.0) | 0.0 (0.0-0.0) |               -0.0 (-94%) |
| All processes                             | 4.2 (3.9-4.7) | 3.1 (3.1-3.1) |               -1.2 (-27%) |

Shown again, CPU (% of one core):

| Process                                   |        Before |         After |                    Change |
| ----------------------------------------- | ------------: | ------------: | ------------------------: |
| Core (Rust, mpv)                          | 3.4 (2.9-4.8) | 4.9 (4.8-5.0) | +1.6 (+46%), within noise |
| Web process (UI, engine worker, BotGuard) | 2.8 (1.9-3.2) | 3.0 (2.9-3.0) |  +0.2 (+7%), within noise |
| Network process                           | 0.1 (0.0-0.1) | 0.1 (0.0-0.1) |  -0.0 (-0%), within noise |
| All processes                             | 6.6 (4.9-7.6) | 7.9 (7.8-8.0) | +1.3 (+20%), within noise |

Window open, wakeups per second:

| Process                                   |        Before |         After |                 Change |
| ----------------------------------------- | ------------: | ------------: | ---------------------: |
| Core (Rust, mpv)                          | 282 (277-287) | 278 (277-279) | -5 (-2%), within noise |
| Web process (UI, engine worker, BotGuard) |   90 (82-105) |  158 (57-213) |             +68 (+76%) |
| Network process                           |       8 (7-8) |       7 (7-8) | -0 (-4%), within noise |
| All processes                             | 375 (372-400) | 444 (341-500) |             +69 (+18%) |

In the tray, wakeups per second:

| Process                                   |        Before |         After |     Change |
| ----------------------------------------- | ------------: | ------------: | ---------: |
| Core (Rust, mpv)                          | 237 (236-244) | 221 (220-221) |  -16 (-7%) |
| Web process (UI, engine worker, BotGuard) |    66 (63-80) |     11 (7-11) | -55 (-83%) |
| Network process                           |       8 (7-8) |       0 (0-0) |  -7 (-94%) |
| All processes                             | 310 (307-331) | 231 (228-233) | -79 (-25%) |

Shown again, wakeups per second:

| Process                                   |        Before |         After |                   Change |
| ----------------------------------------- | ------------: | ------------: | -----------------------: |
| Core (Rust, mpv)                          | 283 (277-316) | 306 (306-308) |  +23 (+8%), within noise |
| Web process (UI, engine worker, BotGuard) |  137 (83-239) | 107 (104-125) | -30 (-22%), within noise |
| Network process                           |       7 (7-8) |       8 (8-8) |                 +0 (+6%) |
| All processes                             | 460 (373-523) | 421 (420-439) |  -40 (-9%), within noise |

`tray-main`: songs found playing in the tray, per run: 6, 6, 6

`tray-unmount`: songs found playing in the tray, per run: 6, 6, 6
