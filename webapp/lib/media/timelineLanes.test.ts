import { describe, expect, it } from 'vitest';

import { packTimelineIntervals } from './timelineLanes';

describe('packTimelineIntervals', () => {
  it('reuses one visual track for non-overlapping intervals', () => {
    const packed = packTimelineIntervals([
      { id: 'later', startFrame: 20, endFrame: 30 },
      { id: 'first', startFrame: 0, endFrame: 10 },
      { id: 'touching', startFrame: 10, endFrame: 20 },
    ]);

    expect(packed.trackCount).toBe(1);
    expect(packed.placements.map(({ interval, trackIndex }) => [interval.id, trackIndex])).toEqual([
      ['first', 0],
      ['touching', 0],
      ['later', 0],
    ]);
  });

  it('stacks overlapping saved and provisional intervals', () => {
    const packed = packTimelineIntervals([
      { id: 'saved', startFrame: 0, endFrame: 20 },
      { id: 'active-a', startFrame: 5, endFrame: 15 },
      { id: 'active-b', startFrame: 7, endFrame: 12 },
      { id: 'after', startFrame: 20, endFrame: 24 },
    ]);

    expect(packed.trackCount).toBe(3);
    expect(Object.fromEntries(packed.placements.map(({ interval, trackIndex }) => [interval.id, trackIndex]))).toEqual({
      saved: 0,
      'active-a': 1,
      'active-b': 2,
      after: 0,
    });
  });
});
