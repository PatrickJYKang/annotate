import { describe, expect, it } from 'vitest';
import { boxOrCircleGeometryFromDrag } from './drawingGeometry';
import { convertImageGeometryToPitchGeometry } from './pitchProjection';

describe('box and circle drawing', () => {
  const start = { x: 200, y: 100 };

  it.each(['box', 'circle'] as const)('does not show a default %s on pointer-down', (type) => {
    expect(boxOrCircleGeometryFromDrag(type, start, start, 'preview')).toBeNull();
  });

  it('previews a tiny drag at its actual size instead of click-to-place dimensions', () => {
    const end = { x: 202, y: 103 };
    expect(boxOrCircleGeometryFromDrag('box', start, end, 'preview')).toEqual({ x: 200, y: 100, w: 2, h: 3 });
    expect(boxOrCircleGeometryFromDrag('circle', start, end, 'preview')).toEqual({ cx: 201, cy: 101.5, rx: 1, ry: 1.5 });
  });

  it('preserves default-size click placement on release', () => {
    for (const end of [start, { x: 203, y: 102 }]) {
      expect(boxOrCircleGeometryFromDrag('box', start, end, 'commit')).toEqual({ x: 140, y: 60, w: 120, h: 80 });
      expect(boxOrCircleGeometryFromDrag('circle', start, end, 'commit')).toEqual({ cx: 200, cy: 100, rx: 50, ry: 30 });
    }
  });

  it.each([[40, 30], [-40, 30], [40, -30], [-40, -30], [4, 0]])('keeps preview and committed drag geometry equal for offset %s, %s', (dx, dy) => {
    const end = { x: start.x + dx, y: start.y + dy };
    for (const type of ['box', 'circle'] as const) {
      const preview = boxOrCircleGeometryFromDrag(type, start, end, 'preview');
      expect(boxOrCircleGeometryFromDrag(type, start, end, 'commit')).toEqual(preview);
      expect(preview).toEqual(type === 'box'
        ? { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(dx), h: Math.abs(dy) }
        : { cx: start.x + dx / 2, cy: start.y + dy / 2, rx: Math.abs(dx) / 2, ry: Math.abs(dy) / 2 });
    }
  });

  it.each(['box', 'circle'] as const)('projects %s previews and commits through the same pitch transform', (type) => {
    const end = { x: 260, y: 150 };
    const inverse = [0.1, 0.02, -10, 0.01, 0.2, 5, 0.0001, 0.0002, 1];
    const preview = boxOrCircleGeometryFromDrag(type, start, end, 'preview')!;
    const committed = boxOrCircleGeometryFromDrag(type, start, end, 'commit')!;
    expect(convertImageGeometryToPitchGeometry(type, preview, inverse))
      .toEqual(convertImageGeometryToPitchGeometry(type, committed, inverse));
  });
});
