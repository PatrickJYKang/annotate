import { describe, expect, it } from 'vitest';

import {
  roundAbsoluteMsToVideoFrame,
  snapClipRelativeMsToVideoFrame,
  stepClipRelativeFrame,
} from './frameMath';

describe('frameMath', () => {
  it('rounds absolute timestamps on the source-video frame grid', () => {
    expect(roundAbsoluteMsToVideoFrame(1450, 30)).toBeCloseTo(1466.667, 2);
  });

  it('snaps clip-relative time using the source-video frame grid, not clip-local zero', () => {
    const snapped = snapClipRelativeMsToVideoFrame(1010, 450, 30);
    expect(snapped).toBeCloseTo(456.667, 2);
  });

  it('steps by one source-video frame even when the clip starts off-grid', () => {
    const next = stepClipRelativeFrame(1010, 456.667, 1, 30, 2000);
    expect(next).toBeCloseTo(490, 2);
  });
});
