### Baseline: main at v0.3.0, fallback client

Fallback (PO-token) scenario, 3 runs of `main` (56f1a7d+dirty, e28d377+dirty) on 2026-10-09. Medians, with the lowest and highest run in brackets. "End" is the mean over the last 60 s of idle; "held" is anonymous memory (PSS_Anon) plus swap, which leaves out shared libraries; PSS counts them too.

| Process | End, held | End, in swap | End, PSS | Peak, held | Peak RSS | Threads at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Core (Rust, mpv) | 190 (176-192) | 0 (0-143) | 258 (111-269) | 190 (176-192) | 348 (339-358) | 49 (49-49) |
| Web process (UI, engine worker, BotGuard) | 335 (288-515) | 0 (0-152) | 421 (203-600) | 508 (474-553) | 714 (667-729) | 38 (38-40) |
| Network process | 8 (8-8) | 0 (0-6) | 17 (9-17) | 8 (8-8) | 51 (51-51) | 11 (11-11) |
| All processes | 519 (485-714) | 0 (0-301) | 697 (324-885) | 627 (619-737) |  | 98 (98-100) |

All processes, held at the end of each phase (MB):

| Phase | Held |
| --- | ---: |
| idle | 148 (148-149) |
| browse | 326 (321-338) |
| long-playlist | 352 (349-365) |
| playback | 499 (491-696) |
| idle-end | 522 (488-719) |
