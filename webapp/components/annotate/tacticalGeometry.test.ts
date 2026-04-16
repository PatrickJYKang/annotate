import { describe, expect, it } from 'vitest';

import {
  buildDefaultLobControlPoint,
  buildShadowSectorPoints,
  getBoundsForFlatPoints,
} from '../../lib/annotate/tacticalGeometry';

describe('tacticalGeometry', () => {
  it('builds a lob control point above a left-to-right pass by default', () => {
    const control = buildDefaultLobControlPoint({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(control.x).toBe(50);
    expect(control.y).toBeLessThan(0);
  });

  it('builds a shadow sector point cloud including the center and arc', () => {
    const points = buildShadowSectorPoints(10, 20, 50, 0, 60, 4);
    expect(points[0]).toBe(10);
    expect(points[1]).toBe(20);
    expect(points.length).toBe((4 + 2) * 2);
  });

  it('computes bounds from flat points', () => {
    expect(getBoundsForFlatPoints([2, 3, 8, 10, 4, 5])).toEqual({
      x: 2,
      y: 3,
      w: 6,
      h: 7,
    });
  });
});
