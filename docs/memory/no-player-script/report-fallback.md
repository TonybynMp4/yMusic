### Skipping the player script, fallback client

Fallback (PO-token) scenario, 3 runs of `main` (56f1a7d+dirty, e28d377+dirty) and 3 of `pr4-no-player-script` (2662e3b), on 2026-10-09, 2026-10-11. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 190 (176-192) | 123 (118-126) | -68 (-36%) |
| Web process (UI, engine worker, BotGuard) | 335 (288-515) | 452 (278-492) | +116 (+35%), within noise |
| Network process | 8 (8-8) | 7 (7-8) | -0 (-1%) |
| All processes | 519 (485-714) | 577 (411-622) | +59 (+11%), within noise |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-143) | 0 (0-0) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-152) | 0 (0-0) | 0, within noise |
| Network process | 0 (0-6) | 0 (0-0) | 0, within noise |
| All processes | 0 (0-301) | 0 (0-0) | 0, within noise |

End of run, PSS with shared libraries (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 258 (111-269) | 204 (201-213) | -54 (-21%), within noise |
| Web process (UI, engine worker, BotGuard) | 421 (203-600) | 530 (363-570) | +109 (+26%), within noise |
| Network process | 17 (9-17) | 17 (17-18) | +0 (+3%), within noise |
| All processes | 697 (324-885) | 748 (593-791) | +51 (+7%), within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 190 (176-192) | 129 (124-134) | -61 (-32%) |
| Web process (UI, engine worker, BotGuard) | 508 (474-553) | 512 (483-527) | +4 (+1%), within noise |
| Network process | 8 (8-8) | 8 (8-8) | -0 (-1%) |
| All processes | 627 (619-737) | 610 (605-643) | -17 (-3%), within noise |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 348 (339-358) | 293 (288-299) | -55 (-16%) |
| Web process (UI, engine worker, BotGuard) | 714 (667-729) | 684 (656-694) | -30 (-4%), within noise |
| Network process | 51 (51-51) | 51 (51-51) | -1 (-1%), within noise |

Threads at end:

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 49 (49-49) | 49 (49-49) | 0 (0%), within noise |
| Web process (UI, engine worker, BotGuard) | 38 (38-40) | 38 (38-38) | 0 (0%), within noise |
| Network process | 11 (11-11) | 11 (11-11) | 0 (0%), within noise |
| All processes | 98 (98-100) | 98 (98-98) | 0 (0%), within noise |

All processes, held at the end of each phase (MB):

| Phase | Before | After | Change |
| --- | ---: | ---: | ---: |
| idle | 148 (148-149) | 145 (137-148) | -3 (-2%) |
| browse | 326 (321-338) | 298 (279-305) | -27 (-8%) |
| long-playlist | 352 (349-365) | 328 (302-333) | -24 (-7%) |
| playback | 499 (491-696) | 550 (405-606) | +50 (+10%), within noise |
| idle-end | 522 (488-719) | 587 (414-643) | +65 (+13%), within noise |
