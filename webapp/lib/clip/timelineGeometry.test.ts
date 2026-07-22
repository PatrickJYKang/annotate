import { describe, expect, it } from 'vitest';

import {
  frameGridStep,
  framePositionX,
  isDeliberateKeyframeDrag,
  timelineXToFrame,
} from './timelineGeometry';

describe('clip timeline frame positions', () => {
  it('places every timeline element on the same frame grid', () => {
    expect(framePositionX(100, 100, 104, 400)).toBe(0);
    expect(framePositionX(101, 100, 104, 400)).toBeCloseTo(400 / 3);
    expect(framePositionX(103, 100, 104, 400)).toBe(400);
  });

  it('snaps pointer positions to the nearest frame line', () => {
    expect(timelineXToFrame(0, 100, 104, 400)).toBe(100);
    expect(timelineXToFrame(66, 100, 104, 400)).toBe(100);
    expect(timelineXToFrame(67, 100, 104, 400)).toBe(101);
    expect(timelineXToFrame(399, 100, 104, 400)).toBe(103);
    expect(timelineXToFrame(400, 100, 104, 400)).toBe(103);
  });

  it('keeps gridlines readable as frames become denser', () => {
    expect(frameGridStep(12)).toBe(1);
    expect(frameGridStep(3)).toBe(5);
    expect(frameGridStep(0.9)).toBe(10);
  });

  it('does not turn ordinary click jitter into a keyframe drag', () => {
    expect(isDeliberateKeyframeDrag(100, 105)).toBe(false);
    expect(isDeliberateKeyframeDrag(100, 106)).toBe(true);
  });
});
