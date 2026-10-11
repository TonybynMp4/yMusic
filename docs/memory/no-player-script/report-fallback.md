### Skipping the player script, fallback client

Fallback (PO-token) scenario, 3 runs of `main` (56f1a7d+dirty, e28d377+dirty) and 3 of `pr4-no-player-script` (2662e3b), on 2026-10-09, 2026-10-11. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is PSS plus swap.

End of run, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 258 (254-269) | 204 (201-213) | -54 (-21%) |
| Web process (UI, engine worker, BotGuard) | 421 (355-600) | 530 (363-570) | +109 (+26%), within noise |
| Network process | 17 (16-17) | 17 (17-18) | +0 (+3%), within noise |
| All processes | 697 (625-885) | 748 (593-791) | +51 (+7%), within noise |

End of run, in RAM (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 258 (111-269) | 204 (201-213) | -54 (-21%), within noise |
| Web process (UI, engine worker, BotGuard) | 421 (203-600) | 530 (363-570) | +109 (+26%), within noise |
| Network process | 17 (9-17) | 17 (17-18) | +0 (+3%), within noise |
| All processes | 697 (324-885) | 748 (593-791) | +51 (+7%), within noise |

End of run, in swap (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 0 (0-143) | 0 (0-0) | 0, within noise |
| Web process (UI, engine worker, BotGuard) | 0 (0-152) | 0 (0-0) | 0, within noise |
| Network process | 0 (0-6) | 0 (0-0) | 0, within noise |
| All processes | 0 (0-301) | 0 (0-0) | 0, within noise |

Peak, held (MB):

| Process | Before | After | Change |
| --- | ---: | ---: | ---: |
| Core (Rust, mpv) | 269 (258-274) | 215 (205-218) | -54 (-20%) |
| Web process (UI, engine worker, BotGuard) | 596 (553-640) | 591 (568-607) | -6 (-1%), within noise |
| Network process | 17 (17-17) | 17 (17-18) | +0 (+2%), within noise |
| All processes | 794 (785-908) | 789 (771-812) | -5 (-1%), within noise |

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
| idle | 311 (292-313) | 308 (294-314) | -3 (-1%), within noise |
| browse | 496 (466-500) | 464 (441-479) | -32 (-6%), within noise |
| long-playlist | 519 (492-527) | 493 (465-507) | -26 (-5%), within noise |
| playback | 677 (667-867) | 720 (586-776) | +43 (+6%), within noise |
| idle-end | 700 (632-889) | 757 (597-812) | +58 (+8%), within noise |
