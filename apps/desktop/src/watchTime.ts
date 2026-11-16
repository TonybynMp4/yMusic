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
 * So each position comes with its time on `performance.now()`'s clock:
 *
 * - A seek moves the position further than the clock moved, or back. A step
 *   forward no longer than the time since the last position is playback that
 *   carried on, and it is fed to `Listened` in steps it accepts.
 * - When a stretch closes (a seek, a pause, the song ending) and the last
 *   position is old, the song had played on since. The time since is added
 *   first, up to the song's end, which needs its length.
 */
export class WatchTime {
  #listened = new Listened();
  /** The position `#listened` saw last, until a pause closes the stretch. */
  #last: { positionMs: number; at: number } | null = null;

  /** A position reached while playing. `durationMs` is the song's length, if known. */
  observe(positionMs: number, at: number, durationMs: number | null): void {
    const last = this.#last;
    if (last) {
      const advanced = positionMs - last.positionMs;
      if (advanced >= 0 && advanced <= at - last.at + SLACK_MS) this.#walkTo(positionMs);
      else this.#playOn(at, durationMs);
    }
    this.#listened.observe(positionMs);
    this.#last = { positionMs, at };
  }

  /**
   * Playback stopped, so the next position starts a stretch of its own. `at`
   * is when it stopped if it was playing until then, and null if it was not.
   */
  pause(at: number | null, durationMs: number | null): void {
    if (at !== null) this.#playOn(at, durationMs);
    this.#listened.pause();
    this.#last = null;
  }

  /** The stretches since the last call, as `Listened.take`. */
  take(): [number, number][] {
    return this.#listened.take();
  }

  /** Extends the open stretch by the time since an old last position. */
  #playOn(at: number, durationMs: number | null): void {
    const last = this.#last;
    if (!last || durationMs === null) return;
    const elapsed = at - last.at;
    // Recent enough to stand, as it always is at one position a second.
    if (elapsed <= Listened.MAX_STEP_MS) return;
    const reached = Math.min(last.positionMs + elapsed, durationMs);
    if (reached <= last.positionMs) return;
    this.#walkTo(reached);
    this.#listened.observe(reached);
    this.#last = { positionMs: reached, at };
  }

  /** Feeds the way from the last position up to, not including, `positionMs`. */
  #walkTo(positionMs: number): void {
    const last = this.#last;
    if (!last) return;
    for (
      let step = last.positionMs + Listened.MAX_STEP_MS;
      step < positionMs;
      step += Listened.MAX_STEP_MS
    ) {
      this.#listened.observe(step);
    }
  }
}
