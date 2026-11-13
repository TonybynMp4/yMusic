### Baseline: main at v0.3.0

Scenario, 3 runs of `main` (56f1a7d+dirty) on 2026-10-09. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

| Process | End, held | End, in swap | End, PSS | Peak, held | Peak RSS | Threads at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Core (Rust, mpv) | 181 (180-187) | 0 (0-0) | 267 (267-273) | 187 (180-190) | 351 (347-358) | 49 (49-49) |
| Web process (UI, engine worker, BotGuard) | 317 (277-335) | 0 (0-0) | 405 (365-423) | 456 (430-481) | 693 (666-707) | 38 (38-40) |
| Network process | 8 (8-8) | 0 (0-0) | 16 (16-16) | 8 (8-8) | 51 (50-51) | 11 (11-11) |
| All processes | 511 (465-524) | 0 (0-0) | 694 (647-706) | 628 (592-630) |  | 98 (98-100) |

All processes, held at the end of each phase (MB):

| Phase | Held |
| --- | ---: |
| idle | 148 (147-148) |
| browse | 337 (330-358) |
| long-playlist | 360 (359-391) |
| playback | 494 (454-510) |
| idle-end | 516 (473-524) |
