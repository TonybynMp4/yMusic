/**
 * The stretches of a song actually listened to, built from position updates.
 * Positions that follow on from the last one extend the current stretch; a
 * jump (a seek, or a gap in the updates) starts a new one. This is what
 * YouTube's watch-time reports carry, so a skim through a song does not count
 * as hearing it all.
 */
export class Listened {
  #done: [number, number][] = [];
  #open: [number, number] | null = null;

  /** A gap longer than this between two updates is treated as a seek. */
  static readonly MAX_STEP_MS = 2500;

  /** A position reached while playing. */
  observe(positionMs: number): void {
    const open = this.#open;
    if (open && positionMs >= open[1] && positionMs - open[1] <= Listened.MAX_STEP_MS) {
      open[1] = positionMs;
      return;
    }
    this.#close();
    this.#open = [positionMs, positionMs];
  }

  /** Playback stopped, so the next position starts a stretch of its own. */
  pause(): void {
    this.#close();
  }

  /**
   * The stretches since the last call. One still growing is reported up to
   * where it has reached and carries on from there.
   */
  take(): [number, number][] {
    const taken = this.#done;
    this.#done = [];
    const open = this.#open;
    if (open && open[1] > open[0]) {
      taken.push([open[0], open[1]]);
      this.#open = [open[1], open[1]];
    }
    return taken;
  }

  #close(): void {
    const open = this.#open;
    if (open && open[1] > open[0]) this.#done.push(open);
    this.#open = null;
  }
}
