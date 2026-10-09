### main

Signed-in scenario, 3 runs of `main` (2815d06+dirty) on 2026-10-09. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is PSS plus swap.

| Process | End, held | End, in RAM | End, in swap | Peak, held | Peak RSS | Threads at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Core (Rust, mpv) | 278 (237-285) | 278 (192-285) | 0 (0-45) | 278 (270-285) | 359 (351-366) | 50 (50-50) |
| Web process (UI, engine worker, BotGuard) | 412 (319-520) | 412 (255-520) | 0 (0-64) | 621 (610-645) | 712 (685-719) | 39 (39-39) |
| Network process | 17 (14-17) | 17 (7-17) | 0 (0-7) | 17 (17-17) | 51 (51-51) | 11 (11-11) |
| All processes | 715 (571-815) | 715 (454-815) | 0 (0-116) | 885 (880-906) |  | 100 (100-100) |

All processes, held at the end of each phase (MB):

| Phase | Held |
| --- | ---: |
| idle | 609 (603-612) |
| browse | 540 (533-548) |
| long-playlist | 552 (548-574) |
| playback | 697 (635-809) |
| idle-end | 717 (554-818) |

`main`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E
