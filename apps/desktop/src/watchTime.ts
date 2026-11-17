import { Listened } from "@ymusic/core";

/**
 * How far a position may run ahead of the clock and still count as having
 * played on: a late timer on one side, a slow reply on the other.
 */
const SLACK_MS = 1500;

/**
 * The stretches of a song listened to, from positions that may come far
 * apart.
 *
 * `Listened` reads any step over `MAX_STEP_MS` as a seek, which holds while
 * the position arrives every second. With the window hidden in the tray it
 * arrives every ten (`HIDDEN_POLL_MS`), and every stretch would be dropped.
 * So each position comes with its time on `performance.now()`'s clock. A seek
 * moves the position further than the clock moved, or back. A step forward no
 * longer than the time since the last position is playback that carried on,
 * and it is fed to `Listened` in steps it accepts.
 *
 * Nothing is estimated from the clock. Where a stretch closes, the position it
 * closed at has to arrive first: Rust sends it ahead of a pause and of a
 * song's end, and a media key that skips or seeks asks for it
 * (`syncPosition`).
 */
export class WatchTime {
  #listened = new Listened();
  /** The position `#listened` saw last, until a pause closes the stretch. */
  #last: { positionMs: number; at: number } | null = null;

  /** A position reached while playing, and when on `performance.now()`'s clock. */
  observe(positionMs: number, at: number): void {
    const last = this.#last;
    if (last) {
      const advanced = positionMs - last.positionMs;
      if (advanced >= 0 && advanced <= at - last.at + SLACK_MS) {
        // The way from the last position up to this one, which follows below.
        for (
          let step = last.positionMs + Listened.MAX_STEP_MS;
          step < positionMs;
          step += Listened.MAX_STEP_MS
        ) {
          this.#listened.observe(step);
        }
      }
    }
    this.#listened.observe(positionMs);
    this.#last = { positionMs, at };
  }

  /** Playback stopped, so the next position starts a stretch of its own. */
  pause(): void {
    this.#listened.pause();
    this.#last = null;
  }

  /** The stretches since the last call, as `Listened.take`. */
  take(): [number, number][] {
    return this.#listened.take();
  }
}
