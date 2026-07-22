import { describe, expect, it } from 'vitest';

import { fitContainedMediaRect } from './mediaGeometry';

describe('fitContainedMediaRect', () => {
  it('centres wide media without stretching it into horizontal letterboxing', () => {
    const rect = fitContainedMediaRect(800, 300, 1024, 576);
    expect(rect.x).toBeCloseTo(400 / 3);
    expect(rect.y).toBe(0);
    expect(rect.width).toBeCloseTo(1600 / 3);
    expect(rect.height).toBe(300);
  });

  it('centres wide media without stretching it into vertical letterboxing', () => {
    expect(fitContainedMediaRect(400, 500, 1024, 576)).toEqual({
      x: 0,
      y: 137.5,
      width: 400,
      height: 225,
    });
  });

  it('returns an empty rectangle until both layout and media dimensions exist', () => {
    expect(fitContainedMediaRect(0, 500, 1024, 576)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
