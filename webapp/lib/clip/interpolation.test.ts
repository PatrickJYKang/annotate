import { describe, expect, it } from 'vitest';

import type { ClipAnnotationType, ClipAnnotation, ClipKeyframe } from '../types/clip';
import { frameBoundary, videoFrame } from './frameMath';
import {
  catmullRom,
  interpolateAnnotation,
  interpolateKeyframes,
  lerp,
} from './interpolation';

const frame = videoFrame;

function resolve(type: ClipAnnotationType, left: ClipKeyframe, right: ClipKeyframe) {
  return interpolateKeyframes([left, right], frame(1), type);
}

function annotation(
  keyframes: ClipKeyframe[],
  patch: Partial<ClipAnnotation> = {},
): ClipAnnotation {
  return {
    id: 'annotation',
    type: 'box',
    coordMode: 'image',
    source: 'manual',
    style: {},
    keyframes,
    ...patch,
  };
}

describe('frame-native interpolation', () => {
  it('returns null for no keyframes and clamps a single keyframe', () => {
    expect(interpolateKeyframes([], frame(0), 'box')).toBeNull();
    expect(interpolateKeyframes([
      { frame: frame(4), x: 1, y: 2, w: 3, h: 4 },
    ], frame(0), 'box')).toEqual({ type: 'box', x: 1, y: 2, w: 3, h: 4 });
  });

  it('interpolates boxes and pitch box quads', () => {
    expect(resolve(
      'box',
      { frame: frame(0), x: 0, y: 10, w: 20, h: 30 },
      { frame: frame(2), x: 10, y: 20, w: 40, h: 50 },
    )).toEqual({ type: 'box', x: 5, y: 15, w: 30, h: 40 });
    expect(resolve(
      'box',
      { frame: frame(0), points: [[0, 0], [2, 0], [2, 2], [0, 2]] },
      { frame: frame(2), points: [[2, 2], [4, 2], [4, 4], [2, 4]] },
    )).toEqual({ type: 'poly', points: [[1, 1], [3, 1], [3, 3], [1, 3]] });
  });

  it('interpolates circles, shadows, and highlights', () => {
    expect(resolve(
      'circle',
      { frame: frame(0), cx: 0, cy: 10, rx: 4, ry: 6 },
      { frame: frame(2), cx: 10, cy: 20, rx: 8, ry: 10 },
    )).toEqual({ type: 'circle', cx: 5, cy: 15, rx: 6, ry: 8 });
    expect(resolve(
      'shadow',
      { frame: frame(0), x: 0, y: 10, r: 20, rotation: 10, spreadDeg: 30 },
      { frame: frame(2), x: 10, y: 20, r: 40, rotation: 30, spreadDeg: 50 },
    )).toEqual({ type: 'shadow', x: 5, y: 15, r: 30, rotation: 20, spreadDeg: 40 });
    expect(resolve(
      'highlight',
      { frame: frame(0), cx: 0, cy: 10, radius: 20 },
      { frame: frame(2), cx: 10, cy: 20, radius: 30 },
    )).toEqual({ type: 'highlight', cx: 5, cy: 15, radius: 25 });
  });

  it('interpolates arrows, lobs, text, and polygons', () => {
    expect(resolve(
      'arrow',
      { frame: frame(0), x1: 0, y1: 0, x2: 10, y2: 10 },
      { frame: frame(2), x1: 2, y1: 4, x2: 12, y2: 14 },
    )).toEqual({ type: 'arrow', x1: 1, y1: 2, x2: 11, y2: 12 });
    expect(resolve(
      'lob',
      { frame: frame(0), x1: 0, y1: 0, cx: 5, cy: -5, x2: 10, y2: 0 },
      { frame: frame(2), x1: 2, y1: 2, cx: 7, cy: -3, x2: 12, y2: 2 },
    )).toEqual({ type: 'lob', x1: 1, y1: 1, cx: 6, cy: -4, x2: 11, y2: 1 });
    expect(resolve(
      'text',
      { frame: frame(0), x: 0, y: 10 },
      { frame: frame(2), x: 10, y: 20 },
    )).toEqual({ type: 'text', x: 5, y: 15 });
    expect(resolve(
      'poly',
      { frame: frame(0), points: [[0, 0], [10, 0], [5, 10]] },
      { frame: frame(2), points: [[2, 2], [12, 2], [7, 12]] },
    )).toEqual({ type: 'poly', points: [[1, 1], [11, 1], [6, 11]] });
  });

  it('hides explicit invisible brackets and manual visibility ranges', () => {
    expect(resolve(
      'box',
      { frame: frame(0), x: 0, y: 0, w: 10, h: 10, visible: false },
      { frame: frame(2), x: 2, y: 2, w: 10, h: 10 },
    )).toBeNull();

    const value = annotation([
      { frame: frame(0), x: 0, y: 0, w: 10, h: 10 },
      { frame: frame(10), x: 10, y: 10, w: 10, h: 10 },
    ], {
      visibilityKeyframes: [
        { frame: frame(3), action: 'hide' },
        { frame: frame(7), action: 'show' },
      ],
    });
    expect(interpolateAnnotation(value, frame(5), frameBoundary(20))).toBeNull();
    expect(interpolateAnnotation(value, frame(8), frameBoundary(20))).not.toBeNull();
  });

  it('does not interpolate across an unsafe sparse tracked gap', () => {
    const tracked = annotation([
      { frame: frame(0), x: 0, y: 0, w: 10, h: 10, provenance: 'tracked' },
      { frame: frame(10), x: 10, y: 10, w: 10, h: 10, provenance: 'tracked' },
    ], { source: 'auto' });
    expect(interpolateAnnotation(tracked, frame(5), frameBoundary(20))).toBeNull();
    expect(interpolateAnnotation(tracked, frame(10), frameBoundary(20))).toEqual({
      type: 'box', x: 10, y: 10, w: 10, h: 10,
    });
  });

  it('resolves dense exact tracked frames without a linear keyframe scan', () => {
    let frameReads = 0;
    const keyframes = Array.from({ length: 1024 }, (_, index) => {
      const keyframe = {
        x: index,
        y: index,
        w: 10,
        h: 10,
        provenance: 'tracked' as const,
      } as ClipKeyframe;
      Object.defineProperty(keyframe, 'frame', {
        enumerable: true,
        get: () => {
          frameReads += 1;
          return frame(index);
        },
      });
      return keyframe;
    });
    const tracked = annotation(keyframes, { source: 'auto' });

    expect(interpolateAnnotation(tracked, frame(900), frameBoundary(1024))).toEqual({
      type: 'box',
      x: 900,
      y: 900,
      w: 10,
      h: 10,
    });
    expect(frameReads).toBeLessThan(40);
  });

  it('reuses hidden-span analysis until an annotation keyframe array changes', () => {
    let frameReads = 0;
    const keyframes = Array.from({ length: 512 }, (_, index) => {
      const keyframe = {
        x: index,
        y: index,
        w: 10,
        h: 10,
        provenance: 'tracked' as const,
      } as ClipKeyframe;
      Object.defineProperty(keyframe, 'frame', {
        enumerable: true,
        get: () => {
          frameReads += 1;
          return frame(index * 2);
        },
      });
      return keyframe;
    });
    const tracked = annotation(keyframes, { source: 'auto' });

    expect(interpolateAnnotation(tracked, frame(501), frameBoundary(1024))).not.toBeNull();
    frameReads = 0;
    expect(interpolateAnnotation(tracked, frame(503), frameBoundary(1024))).not.toBeNull();
    expect(frameReads).toBeLessThan(50);

    tracked.keyframes = [
      { frame: frame(0), x: 0, y: 0, w: 10, h: 10, provenance: 'tracked' },
      { frame: frame(10), x: 10, y: 10, w: 10, h: 10, provenance: 'tracked' },
    ];
    expect(interpolateAnnotation(tracked, frame(5), frameBoundary(1024))).toBeNull();
  });

  it('keeps scalar interpolation helpers deterministic', () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(catmullRom(0, 10, 20, 30, 0.5)).toBe(15);
  });
});
