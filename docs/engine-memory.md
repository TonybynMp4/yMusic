# Engine memory

`packages/youtube/bench` measures the memory of the engine and of the app's caches in front of it, in about fifteen seconds a branch. It runs them under Bun against recorded YouTube responses, so the network and the clock stay out of the numbers.

Bun runs on JavaScriptCore, the engine WebKitGTK uses for the engine worker, so objects stay alive and get collected the same way. The JavaScriptCore versions differ, though. Read the numbers as a comparison between branches, not as what the app's web process will hold.

## Running it

Needs Bun and Linux.

```sh
cd packages/youtube
bun bench/run.ts --record     # once: records YouTube's responses, then measures
bun bench/run.ts              # on each branch, from its worktree
bun bench/compare.ts main my-branch

bun bench/run.ts --scenario session --record   # the long session, about a minute a branch
bun bench/compare.ts main my-branch --scenario session
```

`run.ts` labels its result with the current branch (`--label` overrides it) and saves it in `~/.cache/ymusic/engine-memory/results/`. The recording sits beside it in `recordings/default/`. Because both live outside the checkout, every worktree measures against the same responses and `compare.ts` can read another worktree's result by its label.

## What it runs

`scenario.ts` makes the calls the app makes during the memory harness's session, without the waiting. The `quick` scenario, the default, runs five phases:

1. Browse: ten artists, ten albums and ten playlists, each playlist to its last page as `useBrowse` loads it.
2. Long playlist: the same 1,005-row playlist the harness opens.
3. Playback: the playlist the harness plays from, then `resolve` and `songYear` for its first 20 songs, as the player and NowPlaying do.
4. Fallback: the same 20 songs resolved on the PO-token client, which the player retries a song on when mpv cannot play it. BotGuard runs in jsdom, as in `po-token.test.ts`.
5. App browse: all 31 pages above, opened and left one after another through the app's own `useBrowse.ts`, the long playlist first.

The `session` scenario adds a sixth:

6. App session: hours of skipping through the long playlist. For 700 songs, the app's `useSongYear` looks up the year, as NowPlaying does even for a song skipped at once, and the engine resolves the stream. The streams are kept, as the player keeps them for their six hours.

The first four phases drop each result as soon as it arrives, so what stays alive afterwards is the engine's doing. The `app-` phases load `useBrowse.ts` and `useSongYear.ts` from the branch under test and keep what they keep (`app.ts`). In those two modules, `./engine.ts` becomes the bench's engine, copying each result as the messages from the app's engine worker do, and `react` becomes a stand-in that runs each effect at once and its cleanup on unmount. Nothing renders.

Each phase reports what it got ("20 of 20 streams resolved"), and a comparison prints both sides when they differ. If that line changes, the run did different work, and its numbers do not compare.

## What it does not measure

- The Rust core: libmpv, reqwest and SQLite, and so the glibc arena settings. That takes the harness, or a heap profiler on the core.
- What WebKit holds for the UI: the DOM, layout, images, and the BotGuard frame itself. In the fallback phase the jsdom window stands in for the frame and is counted, but it is no measure of what a WebKit frame costs, so closing the frame when idle does not show either.
- The player's leases going stale. The player drops a lease once it expires, about six hours after it was resolved, and the bench does not wait that long. The app session keeps all 700, which is what the player holds for a session shorter than that.

## What it reports

Each run is a fresh Bun process (`child.ts`). Each phase gets two numbers:

- Peak RSS: the process's high-water mark while the phase ran. Before each phase the child resets it by writing `5` to `/proc/self/clear_refs`. This is what the phase costs at its worst, and it is what the user sees, because JavaScriptCore keeps freed pages for a while before handing them back.
- Retained: the live JS heap plus what its strings and buffers hold outside it, after two full collections. This is what the phase leaves behind: caches, held continuations, compiled code.

Retained memory comes out the same in every run, to within a few hundred kilobytes, so any change there is real. A phase's retained memory includes everything before it, so read a phase's own cost as the step from the phase before. Peak RSS still depends on when JavaScriptCore collects and varies by about 10 to 30 MB, so `run.ts` takes five runs and reports the median and the range. `compare.ts` marks a peak change no larger than the wider of the two sides' ranges as within noise. A large gap between a phase's peak and what it retains points at short-lived garbage, usually parsing.

`compare.ts` also lists which kinds of live objects changed in number by the end of the session, as a first hint at where a difference comes from.

## The recording

`replay.ts` serves each request from the recording by method, URL and body, leaving out the parts that change between identical requests (the InnerTube `context`, `cpn`, timestamps). A request the recording lacks fails the run with its key. When a branch makes a new request, `--record` serves what the recording has and fetches and adds only what is missing, so branches keep sharing the same responses.

Delete `recordings/default/` to record from scratch, for example when YouTube changes a response the engine depends on. Results measured against an older recording no longer compare after that, so measure both branches again.

The first measurement, `main` at `ce3bd79` against `perf/visionos-no-player-script` at `e0bf552`, took about ten seconds a side. It showed the player script parse costing 187 MB of peak RSS during playback and 4.7 MB retained.
