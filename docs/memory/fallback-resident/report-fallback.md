### Stop the fallback path keeping code resident

Fallback (PO-token) scenario, 3 runs of `pr4-no-player-script` (2662e3b) and 3 of `pr5-fallback-resident` (279252f), on 2026-10-11. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 123 (118-126) | 128 (127-132) | +5 (+4%), within noise |
| Web process (UI, engine worker, BotGuard) | 452 (278-492) | 478 (322-494) | +26 (+6%), within noise |
| Network process | 7 (7-8) | 8 (7-8) | +0 (+0%), within noise |
| All processes | 577 (411-622) | 613 (462-628) | +36 (+6%), within noise |

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
| Core (Rust, mpv) | 204 (201-213) | 185 (183-189) | -19 (-9%) |
| Web process (UI, engine worker, BotGuard) | 530 (363-570) | 525 (370-541) | -5 (-1%), within noise |
| Network process | 17 (17-18) | 13 (13-13) | -4 (-24%) |
| All processes | 748 (593-791) | 724 (572-737) | -24 (-3%), within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 129 (124-134) | 136 (135-136) | +7 (+6%), within noise |
| Web process (UI, engine worker, BotGuard) | 512 (483-527) | 509 (496-511) | -4 (-1%), within noise |
| Network process | 8 (8-8) | 8 (8-8) | 0 (0%), within noise |
| All processes | 610 (605-643) | 632 (628-643) | +21 (+4%), within noise |

Peak RSS, from `VmHWM` (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 293 (288-299) | 302 (300-303) | +9 (+3%), within noise |
| Web process (UI, engine worker, BotGuard) | 684 (656-694) | 692 (687-706) | +9 (+1%), within noise |
| Network process | 51 (51-51) | 52 (52-52) | +1 (+2%) |

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
| idle | 145 (137-148) | 148 (145-148) | +2 (+2%), within noise |
| browse | 298 (279-305) | 307 (304-312) | +9 (+3%), within noise |
| long-playlist | 328 (302-333) | 330 (328-341) | +2 (+1%), within noise |
| playback | 550 (405-606) | 591 (445-621) | +41 (+8%), within noise |
| idle-end | 587 (414-643) | 619 (465-631) | +32 (+6%), within noise |
