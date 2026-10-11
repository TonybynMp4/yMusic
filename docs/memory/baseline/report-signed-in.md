### Baseline: main at v0.3.0, signed in

Signed-in scenario, 3 runs of `main` (2815d06+dirty) on 2026-10-09. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

| Process | End, held | End, in swap | End, PSS | Peak, held | Peak RSS | Threads at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Core (Rust, mpv) | 194 (186-202) | 0 (0-45) | 278 (192-285) | 194 (187-202) | 359 (351-366) | 50 (50-50) |
| Web process (UI, engine worker, BotGuard) | 326 (277-436) | 0 (0-64) | 412 (255-520) | 536 (524-558) | 712 (685-719) | 39 (39-39) |
| Network process | 8 (8-8) | 0 (0-7) | 17 (7-17) | 8 (8-8) | 51 (51-51) | 11 (11-11) |
| All processes | 535 (471-638) | 0 (0-116) | 715 (454-815) | 707 (700-727) |  | 100 (100-100) |

All processes, held at the end of each phase (MB):

| Phase | Held |
| --- | ---: |
| idle | 437 (428-438) |
| browse | 364 (359-373) |
| long-playlist | 376 (374-398) |
| playback | 518 (458-632) |
| idle-end | 538 (477-641) |

`main`: stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E; stall yt:syNLBJ_Lq9E
