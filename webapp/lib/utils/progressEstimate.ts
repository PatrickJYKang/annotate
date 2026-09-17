type Sample = { at: number; progress: number };

/** Estimates only the current step; different steps do not share a throughput. */
export class ProgressEstimate {
  private phase: string | null = null;
  private samples: Sample[] = [];
  private lastAdvance = 0;

  record(phase: string, progress: number | undefined, at: number): void {
    const previous = this.samples.at(-1);
    if (phase !== this.phase || progress === undefined || !Number.isFinite(progress)
      || (previous && progress < previous.progress)) {
      this.samples = [];
      this.phase = phase;
    }
    if (progress === undefined || !Number.isFinite(progress)) return;
    const last = this.samples.at(-1);
    if (!last || progress > last.progress) this.lastAdvance = at;
    this.samples.push({ at, progress: Math.max(0, Math.min(1, progress)) });
    while (this.samples.length > 2 && this.samples[1].at <= at - 30_000) this.samples.shift();
  }

  secondsRemaining(at: number): number | null {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (!first || !last || last.progress >= 1 || at - this.lastAdvance > 15_000) return null;
    const elapsed = at - first.at;
    const completed = last.progress - first.progress;
    if (elapsed < 1500 || completed <= 0) return null;
    return Math.max(1, Math.round((1 - last.progress) * elapsed / completed / 1000));
  }
}
