# In the tray: main, and the two tray idle branches

The `tray` scenario of `scripts/memory`, run on 2026-11-17: three runs of `main` (bcd680d), then three of each branch merged into the same harness build, one after the other on the same machine.

| Measured                                                                 | Report                                 | Chart                                        |
| ------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------- |
| `main` alone, the baseline                                               | [report.md](report.md)                 | [timeline.svg](timeline.svg)                 |
| `main` against `feat/tray-idle-signal` (a3879a5)                         | [report-signal.md](report-signal.md)   | [timeline-signal.svg](timeline-signal.svg)   |
| `main` against `feat/tray-idle-unmount` (f591378, stacked on the signal) | [report-unmount.md](report-unmount.md) | [timeline-unmount.svg](timeline-unmount.svg) |

The commits the reports print are local merges of each branch into the harness, which are not pushed.

## What the tray costs on main

With the window hidden and a song changing every minute, all three processes hold 303 MB (294 to 303 across runs), use 4.2% of one core (3.9 to 4.7) and wake 310 times a second (307 to 331). Hiding the window frees no memory: the app holds 301 MB with it open. CPU drops from 5.1% to 4.2% without any change to the app.

The core is the larger share of the running cost. It holds 119 MB, uses 2.6% of a core and wakes 237 times a second, against 177 MB, 1.6% and 66 for the web process. Neither branch changes the core.

Between repeated runs of `main`, memory in the tray moves by 9 MB, CPU by 0.8 points and wakeups by 24 a second.

## What each branch saves in the tray

Medians of three runs, with the lowest and highest in brackets.

| In the tray                        |        `main` |        Signal |       Unmount |
| ---------------------------------- | ------------: | ------------: | ------------: |
| Held, all processes (MB)           | 303 (294-303) | 299 (297-303) | 280 (276-290) |
| Held, web process (MB)             | 177 (173-177) | 173 (169-176) | 156 (154-157) |
| CPU, all processes (% of one core) | 4.2 (3.9-4.7) | 3.2 (3.0-3.2) | 3.1 (3.1-3.1) |
| CPU, web process (% of one core)   | 1.6 (1.5-1.8) | 0.5 (0.4-0.5) | 0.3 (0.3-0.3) |
| Wakeups per second, all processes  | 310 (307-331) | 236 (235-238) | 231 (228-233) |
| Wakeups per second, web process    |    66 (63-80) |    12 (11-16) |     11 (7-11) |

The signal saves no memory: 4 MB is inside the noise. It cuts the web process's CPU by 69% and its wakeups by 81%, which is a quarter of the whole app's CPU and wakeups in the tray. The network process also goes quiet, from 8 wakeups a second to 1.

The unmount saves 23 MB against `main` (8% of the app, 12% of the web process), all of it in the web process. On top of the signal it adds almost nothing for CPU: 0.2 points in the web process and 5 wakeups a second for the app.

## Whether showing the window gives the memory back

With the unmount, the web process grows by 12 MB (12 to 15) in the minute after the window is shown, against 2 MB on `main`. That is about half of what it saved. It ends that minute at 169 MB, 8 MB below `main`, and the scenario opens no page after showing, so pages the user goes back to will load again and take more. The signal ends level with `main`.

On every build the core gains about 11 MB when the window is shown. It is there on `main` too, so it is not a cost of either branch.

## What these runs do not settle

- CPU with the window open reads 1.5 to 2 points higher on both branches than on `main`, in the core as well as the web process, and the core's code is the same with the window open. The branch runs came 35 to 75 minutes after the `main` runs, so this is the machine and not the branches. It puts about a point of doubt on any CPU figure for the whole app. The web process's figures in the tray are far tighter than that (0.4 to 0.5 against 1.5 to 1.8).
- One run of the signal build quit 70 s in, during the browse phase, with no warning in its log and no crash recorded by the kernel. It is left out and was run again. Three later runs of that build finished.
- A WebKit web process of the unmount build crashed in libc as its third run quit, after the last sample. It happened once in three runs and was not looked into.
- Two of the `main` runs had 24 to 64 MB in swap at the end and no branch run did. "Held" counts swap, so the memory figures still compare.
- Six minutes in the tray is short. A leak or a slow release over an hour would not show.
- The scenario is signed out, and plays with the audio muted.
