# Engine memory

`packages/youtube/bench` measures the engine's memory in about ten seconds a branch. It runs the engine under Bun against recorded YouTube responses, so the app, the network and the clock stay out of the numbers.

Bun runs on JavaScriptCore, the engine WebKitGTK uses for the engine worker, so objects stay alive and get collected the same way. The JavaScriptCore versions differ, though. Read the numbers as a comparison between branches, not as what the app's web process will hold.

## Running it

Needs Bun and Linux.

```sh
cd packages/youtube
bun bench/run.ts --record     # once: records YouTube's responses, then measures
bun bench/run.ts              # on each branch, from its worktree
bun bench/compare.ts main my-branch
```

`run.ts` labels its result with the current branch (`--label` overrides it) and saves it in `~/.cache/ymusic/engine-memory/results/`. The recording sits beside it in `recordings/default/`. Because both live outside the checkout, every worktree measures against the same responses and `compare.ts` can read another worktree's result by its label.

## What it runs

`scenario.ts` makes the engine calls the app makes during the memory harness's session, without the waiting:

1. Browse: ten artists, ten albums and ten playlists, each playlist to its last page as `useBrowse` loads it.
2. Long playlist: the same 1,005-row playlist the harness opens.
3. Playback: the playlist the harness plays from, then `resolve` and `songYear` for its first 20 songs, as the player and NowPlaying do.

The scenario drops each result as soon as it arrives, so what stays alive afterwards is the engine's doing and not the UI's. Each phase reports what it got ("20 of 20 streams resolved"), and a comparison prints both sides when they differ. If that line changes, the run did different work, and its numbers do not compare.

## What it reports

Each run is a fresh Bun process (`child.ts`). Each phase gets two numbers:

- Peak RSS: the process's high-water mark while the phase ran. Before each phase the child resets it by writing `5` to `/proc/self/clear_refs`. This is what the phase costs at its worst, and it is what the user sees, because JavaScriptCore keeps freed pages for a while before handing them back.
- Retained: the live JS heap plus what its strings and buffers hold outside it, after two full collections. This is what the phase leaves behind: caches, held continuations, compiled code.

Retained memory comes out the same in every run, to within a few hundred kilobytes, so any change there is real. Peak RSS still depends on when JavaScriptCore collects and varies by about 10 to 30 MB, so `run.ts` takes five runs and reports the median and the range. `compare.ts` marks a peak change smaller than either side's range as within noise. A large gap between a phase's peak and what it retains points at short-lived garbage, usually parsing.

`compare.ts` also lists which kinds of live objects changed in number by the end of the session, as a first hint at where a difference comes from.

## The recording

`replay.ts` serves each request from the recording by method, URL and body, leaving out the parts that change between identical requests (the InnerTube `context`, `cpn`, timestamps). A request the recording lacks fails the run with its key. When a branch makes a new request, `--record` serves what the recording has and fetches and adds only what is missing, so branches keep sharing the same responses.

Delete `recordings/default/` to record from scratch, for example when YouTube changes a response the engine depends on. Results measured against an older recording no longer compare after that, so measure both branches again.

The first measurement, `main` at `ce3bd79` against `perf/visionos-no-player-script` at `e0bf552`, took about ten seconds a side. It showed the player script parse costing 187 MB of peak RSS during playback and 4.7 MB retained.
