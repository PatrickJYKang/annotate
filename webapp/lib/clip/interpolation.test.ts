import { describe, it, expect } from 'vitest';
import {
  interpolateAnnotationAtTime,
  interpolateKeyframes,
  lerp,
  catmullRom,
  findBracketIndex,
} from './interpolation';
import type {
  ClipAnnotation,
  BoxKeyframe,
  CircleKeyframe,
  ShadowKeyframe,
  ArrowKeyframe,
  LobKeyframe,
  TextKeyframe,
  PolyKeyframe,
  HighlightKeyframe,
  ClipKeyframe,
} from '../types/clip';

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

function boxKf(tMs: number, x: number, y: number, w: number, h: number, visible?: boolean): BoxKeyframe {
  return { tMs, x, y, w, h, ...(visible !== undefined ? { visible } : {}) };
}

function circleKf(tMs: number, cx: number, cy: number, rx: number, ry: number): CircleKeyframe {
  return { tMs, cx, cy, rx, ry };
}

function shadowKf(tMs: number, x: number, y: number, r: number, rotation: number, spreadDeg: number): ShadowKeyframe {
  return { tMs, x, y, r, rotation, spreadDeg };
}

function arrowKf(tMs: number, x1: number, y1: number, x2: number, y2: number): ArrowKeyframe {
  return { tMs, x1, y1, x2, y2 };
}

function lobKf(tMs: number, x1: number, y1: number, cx: number, cy: number, x2: number, y2: number): LobKeyframe {
  return { tMs, x1, y1, cx, cy, x2, y2 };
}

function textKf(tMs: number, x: number, y: number): TextKeyframe {
  return { tMs, x, y };
}

function polyKf(tMs: number, points: [number, number][]): PolyKeyframe {
  return { tMs, points };
}

function highlightKf(tMs: number, cx: number, cy: number, radius: number): HighlightKeyframe {
  return { tMs, cx, cy, radius };
}

function makeBoxAnnotation(id: string, source: ClipAnnotation["source"], keyframes: ClipKeyframe[]): ClipAnnotation {
  return {
    id,
    type: 'box',
    coordMode: 'image',
    source,
    style: {},
    keyframes,
  };
}

// ---------------------------------------------------------------------------
// Unit helpers
// ---------------------------------------------------------------------------

describe('lerp', () => {
  it('returns a at t=0', () => expect(lerp(10, 20, 0)).toBe(10));
  it('returns b at t=1', () => expect(lerp(10, 20, 1)).toBe(20));
  it('returns midpoint at t=0.5', () => expect(lerp(10, 20, 0.5)).toBe(15));
});

describe('catmullRom', () => {
  it('returns p1 at t=0', () => expect(catmullRom(0, 10, 20, 30, 0)).toBe(10));
  it('returns p2 at t=1', () => expect(catmullRom(0, 10, 20, 30, 1)).toBe(20));
  it('returns smooth midpoint', () => {
    const mid = catmullRom(0, 10, 20, 30, 0.5);
    expect(mid).toBeCloseTo(15, 5);
  });
});

describe('findBracketIndex', () => {
  const kfs: ClipKeyframe[] = [
    boxKf(0, 0, 0, 10, 10),
    boxKf(100, 10, 10, 20, 20),
    boxKf(200, 20, 20, 30, 30),
    boxKf(300, 30, 30, 40, 40),
  ];

  it('clamps to 0 for t before first', () => expect(findBracketIndex(kfs, -10)).toBe(0));
  it('returns last index for t after last', () => expect(findBracketIndex(kfs, 500)).toBe(3));
  it('returns 0 for t=0', () => expect(findBracketIndex(kfs, 0)).toBe(0));
  it('returns 0 for t=50', () => expect(findBracketIndex(kfs, 50)).toBe(0));
  it('returns 1 for t=150', () => expect(findBracketIndex(kfs, 150)).toBe(1));
  it('returns 2 for t=250', () => expect(findBracketIndex(kfs, 250)).toBe(2));
  it('returns exact keyframe index', () => expect(findBracketIndex(kfs, 200)).toBe(2));
});

// ---------------------------------------------------------------------------
// interpolateKeyframes
// ---------------------------------------------------------------------------

describe('interpolateKeyframes', () => {
  // --- Empty / single ---

  it('returns null for empty keyframes', () => {
    expect(interpolateKeyframes([], 0, 'box')).toBeNull();
  });

  it('clamps to single keyframe', () => {
    const r = interpolateKeyframes([boxKf(100, 5, 10, 20, 30)], 50, 'box');
    expect(r).toEqual({ type: 'box', x: 5, y: 10, w: 20, h: 30 });
  });

  it('returns null if single keyframe has visible: false', () => {
    expect(interpolateKeyframes([boxKf(100, 0, 0, 10, 10, false)], 50, 'box')).toBeNull();
  });

  // --- Clamp before/after ---

  it('clamps before first keyframe', () => {
    const kfs = [boxKf(100, 1, 2, 3, 4), boxKf(200, 10, 20, 30, 40)];
    const r = interpolateKeyframes(kfs, 0, 'box');
    expect(r).toEqual({ type: 'box', x: 1, y: 2, w: 3, h: 4 });
  });

  it('clamps after last keyframe', () => {
    const kfs = [boxKf(100, 1, 2, 3, 4), boxKf(200, 10, 20, 30, 40)];
    const r = interpolateKeyframes(kfs, 999, 'box');
    expect(r).toEqual({ type: 'box', x: 10, y: 20, w: 30, h: 40 });
  });

  // --- visible: false ---

  it('returns null if first bracket keyframe is invisible', () => {
    const kfs = [boxKf(0, 0, 0, 10, 10, false), boxKf(100, 10, 10, 20, 20)];
    expect(interpolateKeyframes(kfs, 50, 'box')).toBeNull();
  });

  it('returns null if second bracket keyframe is invisible', () => {
    const kfs = [boxKf(0, 0, 0, 10, 10), boxKf(100, 10, 10, 20, 20, false)];
    expect(interpolateKeyframes(kfs, 50, 'box')).toBeNull();
  });

  it('returns null if clamped-to last keyframe is invisible', () => {
    const kfs = [boxKf(0, 0, 0, 10, 10), boxKf(100, 10, 10, 20, 20, false)];
    expect(interpolateKeyframes(kfs, 200, 'box')).toBeNull();
  });

  it('keeps continuity through a short tracked gap', () => {
    const annotation = makeBoxAnnotation('ann-short-gap', 'corrected', [
      { ...boxKf(0, 0, 0, 10, 10), provenance: 'tracked' },
      { ...boxKf(150, 15, 15, 10, 10), provenance: 'tracked' },
    ]);

    const r = interpolateAnnotationAtTime(annotation, 75, 30, 300);
    expect(r).not.toBeNull();
    expect(r).toEqual({ type: 'box', x: 7.5, y: 7.5, w: 10, h: 10 });
  });

  it('hides a long tracked gap conservatively', () => {
    const annotation = makeBoxAnnotation('ann-long-gap', 'corrected', [
      { ...boxKf(0, 0, 0, 10, 10), provenance: 'tracked' },
      { ...boxKf(400, 40, 40, 10, 10), provenance: 'tracked' },
    ]);

    expect(interpolateAnnotationAtTime(annotation, 200, 30, 500)).toBeNull();
    expect(interpolateAnnotationAtTime(annotation, 0, 30, 500)).toEqual({ type: 'box', x: 0, y: 0, w: 10, h: 10 });
    expect(interpolateAnnotationAtTime(annotation, 400, 30, 500)).toEqual({ type: 'box', x: 40, y: 40, w: 10, h: 10 });
  });

  it('stays hidden until a correction after a long tracked gap', () => {
    const annotation = makeBoxAnnotation('ann-correction-gap', 'corrected', [
      { ...boxKf(100, 10, 10, 10, 10), provenance: 'tracked' },
      { ...boxKf(700, 70, 70, 10, 10), provenance: 'correction' },
    ]);

    expect(interpolateAnnotationAtTime(annotation, 400, 30, 900)).toBeNull();
    expect(interpolateAnnotationAtTime(annotation, 700, 30, 900)).toEqual({ type: 'box', x: 70, y: 70, w: 10, h: 10 });
  });

  it('uses show/hide visibility keyframes as playback events without affecting position interpolation', () => {
    const annotation: ClipAnnotation = {
      id: 'ann-visibility-events',
      type: 'box',
      coordMode: 'image',
      source: 'manual',
      style: {},
      keyframes: [
        boxKf(0, 0, 0, 10, 10),
        boxKf(1000, 100, 100, 10, 10),
      ],
      visibilityKeyframes: [
        { tMs: 200, action: 'hide' },
        { tMs: 500, action: 'show' },
      ],
    };

    expect(interpolateAnnotationAtTime(annotation, 150, 30, 1000)).toEqual({
      type: 'box',
      x: 15,
      y: 15,
      w: 10,
      h: 10,
    });
    expect(interpolateAnnotationAtTime(annotation, 200, 30, 1000)).toBeNull();
    expect(interpolateAnnotationAtTime(annotation, 350, 30, 1000)).toBeNull();
    expect(interpolateAnnotationAtTime(annotation, 500, 30, 1000)).toEqual({
      type: 'box',
      x: 50,
      y: 50,
      w: 10,
      h: 10,
    });
    expect(interpolateAnnotationAtTime(annotation, 750, 30, 1000)).toEqual({
      type: 'box',
      x: 75,
      y: 75,
      w: 10,
      h: 10,
    });
  });

  // --- Linear box interpolation (close keyframes, gap ≤ 2 frames at 30fps) ---

  it('linearly interpolates box at midpoint (close kfs)', () => {
    // gap = 33ms < 66ms (2 frames at 30fps) → linear
    const kfs = [boxKf(0, 0, 0, 10, 10), boxKf(33, 10, 20, 30, 40)];
    const r = interpolateKeyframes(kfs, 16.5, 'box', 30);
    expect(r).not.toBeNull();
    expect(r!.type).toBe('box');
    const b = r as { type: 'box'; x: number; y: number; w: number; h: number };
    expect(b.x).toBeCloseTo(5, 1);
    expect(b.y).toBeCloseTo(10, 1);
    expect(b.w).toBeCloseTo(20, 1);
    expect(b.h).toBeCloseTo(25, 1);
  });

  // --- Cubic box interpolation (distant keyframes) ---

  it('uses cubic interpolation for distant keyframes', () => {
    // 4 keyframes spaced 1000ms apart → gap >> 2 frames → cubic
    const kfs = [boxKf(0, 0, 0, 10, 10), boxKf(1000, 100, 100, 50, 50), boxKf(2000, 200, 200, 90, 90), boxKf(3000, 300, 300, 130, 130)];
    const r = interpolateKeyframes(kfs, 1500, 'box', 30);
    expect(r).not.toBeNull();
    const b = r as { type: 'box'; x: number; y: number; w: number; h: number };
    // Catmull-Rom with uniform spacing should give smooth results close to linear midpoint
    expect(b.x).toBeCloseTo(150, 0);
    expect(b.y).toBeCloseTo(150, 0);
  });

  // --- Circle ---

  it('interpolates circle keyframes', () => {
    const kfs = [circleKf(0, 10, 20, 5, 8), circleKf(100, 30, 40, 15, 18)];
    const r = interpolateKeyframes(kfs, 50, 'circle', 30);
    expect(r).not.toBeNull();
    expect(r!.type).toBe('circle');
    const c = r as { type: 'circle'; cx: number; cy: number; rx: number; ry: number };
    expect(c.cx).toBeCloseTo(20, 1);
    expect(c.cy).toBeCloseTo(30, 1);
    expect(c.rx).toBeCloseTo(10, 1);
    expect(c.ry).toBeCloseTo(13, 1);
  });

  it('interpolates shadow keyframes', () => {
    const kfs = [shadowKf(0, 10, 20, 40, 15, 30), shadowKf(100, 30, 40, 80, 45, 60)];
    const r = interpolateKeyframes(kfs, 50, 'shadow', 30);
    expect(r).not.toBeNull();
    expect(r!.type).toBe('shadow');
    const s = r as { type: 'shadow'; x: number; y: number; r: number; rotation: number; spreadDeg: number };
    expect(s.x).toBeCloseTo(20, 1);
    expect(s.y).toBeCloseTo(30, 1);
    expect(s.r).toBeCloseTo(60, 1);
    expect(s.rotation).toBeCloseTo(30, 1);
    expect(s.spreadDeg).toBeCloseTo(45, 1);
  });

  // --- Arrow ---

  it('interpolates arrow keyframes', () => {
    const kfs = [arrowKf(0, 0, 0, 100, 100), arrowKf(200, 50, 50, 150, 150)];
    const r = interpolateKeyframes(kfs, 100, 'arrow', 30);
    expect(r).not.toBeNull();
    const a = r as { type: 'arrow'; x1: number; y1: number; x2: number; y2: number };
    expect(a.x1).toBeCloseTo(25, 0);
    expect(a.y1).toBeCloseTo(25, 0);
    expect(a.x2).toBeCloseTo(125, 0);
    expect(a.y2).toBeCloseTo(125, 0);
  });

  it('interpolates lob keyframes', () => {
    const kfs = [lobKf(0, 0, 0, 20, -10, 40, 0), lobKf(200, 20, 10, 40, 20, 80, 30)];
    const r = interpolateKeyframes(kfs, 100, 'lob', 30);
    expect(r).not.toBeNull();
    expect(r!.type).toBe('lob');
    const l = r as { type: 'lob'; x1: number; y1: number; cx: number; cy: number; x2: number; y2: number };
    expect(l.x1).toBeCloseTo(10, 0);
    expect(l.y1).toBeCloseTo(5, 0);
    expect(l.cx).toBeCloseTo(30, 0);
    expect(l.cy).toBeCloseTo(5, 0);
    expect(l.x2).toBeCloseTo(60, 0);
    expect(l.y2).toBeCloseTo(15, 0);
  });

  // --- Text ---

  it('interpolates text keyframes', () => {
    const kfs = [textKf(0, 10, 20), textKf(100, 50, 60)];
    const r = interpolateKeyframes(kfs, 25, 'text', 30);
    expect(r).not.toBeNull();
    const t = r as { type: 'text'; x: number; y: number };
    expect(t.x).toBeCloseTo(20, 0);
    expect(t.y).toBeCloseTo(30, 0);
  });

  // --- Poly (always linear, per-vertex) ---

  it('interpolates poly keyframes linearly per vertex', () => {
    const kfs = [
      polyKf(0, [[0, 0], [10, 0], [10, 10], [0, 10]]),
      polyKf(100, [[20, 20], [30, 20], [30, 30], [20, 30]]),
    ];
    const r = interpolateKeyframes(kfs, 50, 'poly', 30);
    expect(r).not.toBeNull();
    const p = r as { type: 'poly'; points: [number, number][] };
    expect(p.points[0]).toEqual([10, 10]);
    expect(p.points[1]).toEqual([20, 10]);
    expect(p.points[2]).toEqual([20, 20]);
    expect(p.points[3]).toEqual([10, 20]);
  });

  // --- Highlight ---

  it('interpolates highlight keyframes', () => {
    const kfs = [highlightKf(0, 100, 200, 50), highlightKf(200, 300, 400, 150)];
    const r = interpolateKeyframes(kfs, 100, 'highlight', 30);
    expect(r).not.toBeNull();
    const h = r as { type: 'highlight'; cx: number; cy: number; radius: number };
    expect(h.cx).toBeCloseTo(200, 0);
    expect(h.cy).toBeCloseTo(300, 0);
    expect(h.radius).toBeCloseTo(100, 0);
  });

  // --- Edge: exact keyframe time ---

  it('returns exact keyframe when tMs matches', () => {
    const kfs = [boxKf(0, 0, 0, 10, 10), boxKf(100, 20, 20, 40, 40)];
    const r = interpolateKeyframes(kfs, 100, 'box');
    expect(r).toEqual({ type: 'box', x: 20, y: 20, w: 40, h: 40 });
  });

  it('returns exact keyframe at first tMs', () => {
    const kfs = [boxKf(0, 5, 5, 15, 15), boxKf(100, 20, 20, 40, 40)];
    const r = interpolateKeyframes(kfs, 0, 'box');
    expect(r).toEqual({ type: 'box', x: 5, y: 5, w: 15, h: 15 });
  });

  // --- Unknown type ---

  it('returns null for unknown annotation type', () => {
    const kfs = [boxKf(0, 0, 0, 10, 10)];
    expect(interpolateKeyframes(kfs, 0, 'unknown' as any)).toBeNull();
  });
});
