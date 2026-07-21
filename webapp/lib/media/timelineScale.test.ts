import { describe, expect, it } from 'vitest';

import { calculateTimelineScale } from './timelineScale';

describe('calculateTimelineScale', () => {
  it('shows one minute of a long video at 1x', () => {
    const scale = calculateTimelineScale(2 * 60 * 60, 1200, 1);

    expect(scale.defaultVisibleSeconds).toBe(60);
    expect(scale.pixelsPerSecond).toBe(20);
    expect(1200 / scale.pixelsPerSecond).toBe(60);
    expect(scale.totalWidth).toBe(144_000);
  });

  it('zooms out far enough to fit the complete video', () => {
    const scale = calculateTimelineScale(2 * 60 * 60, 1200, 0);

    expect(scale.minimumZoom).toBeCloseTo(1 / 120);
    expect(scale.zoom).toBe(scale.minimumZoom);
    expect(scale.totalWidth).toBeCloseTo(1200);
  });

  it('fits a video shorter than one minute at 1x', () => {
    const scale = calculateTimelineScale(30, 1200, 1);

    expect(scale.defaultVisibleSeconds).toBe(30);
    expect(scale.minimumZoom).toBe(1);
    expect(scale.totalWidth).toBe(1200);
  });
});
