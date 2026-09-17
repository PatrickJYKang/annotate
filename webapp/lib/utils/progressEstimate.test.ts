import { describe, expect, it } from 'vitest';
import { ProgressEstimate } from './progressEstimate';

describe('progress-based remaining time', () => {
  it('uses measured progress, not a fixed expected duration', () => {
    const estimate = new ProgressEstimate();
    estimate.record('transcoding', 0, 0);
    expect(estimate.secondsRemaining(1000)).toBeNull();
    estimate.record('transcoding', 0.25, 10_000);
    expect(estimate.secondsRemaining(10_000)).toBe(30);
    estimate.record('transcoding', 0.5, 20_000);
    expect(estimate.secondsRemaining(20_000)).toBe(20);
  });

  it('does not inherit upload speed or unknown progress into a new step', () => {
    const estimate = new ProgressEstimate();
    estimate.record('uploading', 0, 0);
    estimate.record('uploading', 0.5, 2000);
    expect(estimate.secondsRemaining(2000)).toBe(2);
    estimate.record('transcoding', 0, 3000);
    expect(estimate.secondsRemaining(3000)).toBeNull();
    estimate.record('queued', undefined, 4000);
    expect(estimate.secondsRemaining(4000)).toBeNull();
  });

  it('responds to slowing progress and hides stale estimates instead of counting down', () => {
    const estimate = new ProgressEstimate();
    estimate.record('copying', 0, 0);
    estimate.record('copying', 0.5, 2000);
    expect(estimate.secondsRemaining(2000)).toBe(2);
    expect(estimate.secondsRemaining(6000)).toBe(6);
    expect(estimate.secondsRemaining(18_000)).toBeNull();
    estimate.record('copying', 1, 19_000);
    expect(estimate.secondsRemaining(19_000)).toBeNull();
  });

  it('forgets old rates and resets when a retry moves progress backwards', () => {
    const estimate = new ProgressEstimate();
    for (let second = 0; second <= 60; second++) {
      estimate.record('transcoding', second <= 30 ? second / 100 : 0.3 + (second - 30) / 200, second * 1000);
    }
    expect(estimate.secondsRemaining(60_000)).toBe(110);
    estimate.record('transcoding', 0, 61_000);
    expect(estimate.secondsRemaining(61_000)).toBeNull();
  });
});
