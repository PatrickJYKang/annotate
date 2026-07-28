import { describe, expect, it } from 'vitest';

import { placeHighlightLabel } from './highlightLabel';

describe('placeHighlightLabel', () => {
  it('places a label to the right of a highlight when space is available', () => {
    expect(placeHighlightLabel({
      centerX: 100,
      centerY: 100,
      radiusX: 20,
      radiusY: 8,
      textWidth: 80,
      textHeight: 20,
      frameWidth: 400,
      frameHeight: 200,
      gap: 10,
      padding: 5,
    })).toEqual({ x: 130, y: 90, width: 80, height: 20, side: 'right' });
  });

  it('moves a label to the left when the highlight is close to the right edge', () => {
    expect(placeHighlightLabel({
      centerX: 360,
      centerY: 100,
      radiusX: 20,
      radiusY: 8,
      textWidth: 80,
      textHeight: 20,
      frameWidth: 400,
      frameHeight: 200,
      gap: 10,
      padding: 5,
    })).toEqual({ x: 250, y: 90, width: 80, height: 20, side: 'left' });
  });

  it('clamps labels inside the top, bottom, and horizontal frame edges', () => {
    const top = placeHighlightLabel({
      centerX: 4,
      centerY: 2,
      radiusX: 20,
      radiusY: 8,
      textWidth: 500,
      textHeight: 24,
      frameWidth: 200,
      frameHeight: 100,
      gap: 8,
      padding: 6,
    });
    const bottom = placeHighlightLabel({
      centerX: 100,
      centerY: 99,
      radiusX: 20,
      radiusY: 8,
      textWidth: 60,
      textHeight: 24,
      frameWidth: 200,
      frameHeight: 100,
      gap: 8,
      padding: 6,
    });

    expect(top).toMatchObject({ x: 6, y: 6, width: 188 });
    expect(top.x + top.width).toBeLessThanOrEqual(194);
    expect(bottom.y).toBe(70);
    expect(bottom.y + bottom.height).toBeLessThanOrEqual(94);
  });
});
