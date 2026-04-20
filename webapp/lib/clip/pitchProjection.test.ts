import { describe, expect, it } from 'vitest';

import {
  annotationTypeSupportsPitchCoords,
  convertImageGeometryToPitchGeometry,
  getProjectedPitchShapeBounds,
  projectImagePointToPitchPoint,
  projectPitchKeyframeToImageShape,
} from './pitchProjection';

describe('annotationTypeSupportsPitchCoords', () => {
  it('supports the pitch-aware clip tools', () => {
    expect(annotationTypeSupportsPitchCoords('box')).toBe(true);
    expect(annotationTypeSupportsPitchCoords('circle')).toBe(true);
    expect(annotationTypeSupportsPitchCoords('arrow')).toBe(true);
    expect(annotationTypeSupportsPitchCoords('lob')).toBe(true);
    expect(annotationTypeSupportsPitchCoords('text')).toBe(true);
    expect(annotationTypeSupportsPitchCoords('highlight')).toBe(true);
  });

  it('keeps shadow image-space only for now', () => {
    expect(annotationTypeSupportsPitchCoords('shadow')).toBe(false);
  });
});

describe('convertImageGeometryToPitchGeometry', () => {
  const translateInverse = [1, 0, -10, 0, 1, -20, 0, 0, 1];

  it('converts image points into pitch points using the inverse homography', () => {
    expect(projectImagePointToPitchPoint(translateInverse, 16, 29)).toEqual({ u: 6, v: 9 });
  });

  it('converts box geometry conservatively into pitch-space bounds', () => {
    expect(
      convertImageGeometryToPitchGeometry('box', { x: 10, y: 20, w: 30, h: 40 }, translateInverse),
    ).toEqual({ x: 0, y: 0, w: 30, h: 40 });
  });

  it('converts lob control points into pitch-space', () => {
    expect(
      convertImageGeometryToPitchGeometry('lob', { x1: 20, y1: 30, cx: 40, cy: 10, x2: 60, y2: 25 }, translateInverse),
    ).toEqual({ x1: 10, y1: 10, cx: 30, cy: -10, x2: 50, y2: 5 });
  });
});

describe('projectPitchKeyframeToImageShape', () => {
  const translate = [1, 0, 10, 0, 1, 20, 0, 0, 1];

  it('projects pitch-space boxes into image polygons', () => {
    const projected = projectPitchKeyframeToImageShape(
      { type: 'box', x: 0, y: 0, w: 20, h: 10 },
      translate,
    );

    expect(projected).toEqual({
      kind: 'polygon',
      points: [10, 20, 30, 20, 30, 30, 10, 30],
    });
    expect(getProjectedPitchShapeBounds(projected!, 16)).toEqual({ x: 10, y: 20, w: 20, h: 10 });
  });

  it('projects pitch-space arrows and text at playback time', () => {
    const arrow = projectPitchKeyframeToImageShape(
      { type: 'arrow', x1: 0, y1: 0, x2: 15, y2: 5 },
      translate,
    );
    const text = projectPitchKeyframeToImageShape(
      { type: 'text', x: 8, y: 4 },
      translate,
    );

    expect(arrow).toEqual({ kind: 'arrow', points: [10, 20, 25, 25] });
    expect(text).toEqual({ kind: 'text', x: 18, y: 24 });
    expect(getProjectedPitchShapeBounds(text!, 18)).toEqual({ x: 18, y: 24, w: 100, h: 18 });
  });
});
