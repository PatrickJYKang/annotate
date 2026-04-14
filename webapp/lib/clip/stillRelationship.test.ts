import { describe, expect, it } from 'vitest';

import { getClipRelativeMsForStill, isStillWithinClipBounds, listStillsWithinClipBounds } from './stillRelationship';

describe('isStillWithinClipBounds', () => {
  const clip = { videoId: 'video-a', startMs: 1000, endMs: 2000 };

  it('includes stills on the inclusive start and end bounds', () => {
    expect(isStillWithinClipBounds(clip, { videoId: 'video-a', t_ms: 1000 })).toBe(true);
    expect(isStillWithinClipBounds(clip, { videoId: 'video-a', t_ms: 2000 })).toBe(true);
  });

  it('excludes stills outside the time bounds', () => {
    expect(isStillWithinClipBounds(clip, { videoId: 'video-a', t_ms: 999 })).toBe(false);
    expect(isStillWithinClipBounds(clip, { videoId: 'video-a', t_ms: 2001 })).toBe(false);
  });

  it('excludes stills from a different video even when timestamps overlap', () => {
    expect(isStillWithinClipBounds(clip, { videoId: 'video-b', t_ms: 1500 })).toBe(false);
  });
});

describe('listStillsWithinClipBounds', () => {
  const clip = { videoId: 'video-a', startMs: 1000, endMs: 2000 };
  const stills = [
    { id: 'still-3', videoId: 'video-a', t_ms: 1500, file: 'stills/3.png' },
    { id: 'still-2', videoId: 'video-a', t_ms: 1500, file: 'stills/2.png' },
    { id: 'still-1', videoId: 'video-a', t_ms: 1000, file: 'stills/1.png' },
    { id: 'still-4', videoId: 'video-a', t_ms: 2500, file: 'stills/4.png' },
    { id: 'still-5', videoId: 'video-b', t_ms: 1500, file: 'stills/5.png' },
  ];

  it('filters by the derived relationship and sorts chronologically', () => {
    expect(listStillsWithinClipBounds(stills, clip).map((still) => still.id)).toEqual([
      'still-1',
      'still-2',
      'still-3',
    ]);
  });
});

describe('getClipRelativeMsForStill', () => {
  it('converts an in-bounds still timestamp to clip-relative ms', () => {
    expect(getClipRelativeMsForStill({ startMs: 1000 }, { t_ms: 1450 })).toBe(450);
  });
});
