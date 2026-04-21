// ---------------------------------------------------------------------------
// Clip keyframe interpolation engine
// See plans/post-mvp/clips/clips-feature.md §3 (Phase 3)
// ---------------------------------------------------------------------------

import type {
  ClipAnnotation,
  ClipAnnotationType,
  ClipKeyframe,
  BoxKeyframe,
  CircleKeyframe,
  ShadowKeyframe,
  ArrowKeyframe,
  LobKeyframe,
  TextKeyframe,
  PolyKeyframe,
  HighlightKeyframe,
} from '../types/clip';
import { getHiddenSpans, isTimeWithinHiddenSpan } from './trackingState';

// ---------------------------------------------------------------------------
// Result types — one per annotation type
// ---------------------------------------------------------------------------

export interface InterpolatedBox {
  type: 'box';
  x: number; y: number; w: number; h: number;
}

export interface InterpolatedCircle {
  type: 'circle';
  cx: number; cy: number; rx: number; ry: number;
}

export interface InterpolatedShadow {
  type: 'shadow';
  x: number; y: number; r: number; rotation: number; spreadDeg: number;
}

export interface InterpolatedArrow {
  type: 'arrow';
  x1: number; y1: number; x2: number; y2: number;
}

export interface InterpolatedLob {
  type: 'lob';
  x1: number; y1: number; cx: number; cy: number; x2: number; y2: number;
}

export interface InterpolatedText {
  type: 'text';
  x: number; y: number;
}

export interface InterpolatedPoly {
  type: 'poly';
  points: [number, number][];
}

export interface InterpolatedHighlight {
  type: 'highlight';
  cx: number; cy: number; radius: number;
}

export type InterpolatedKeyframe =
  | InterpolatedBox
  | InterpolatedCircle
  | InterpolatedShadow
  | InterpolatedArrow
  | InterpolatedLob
  | InterpolatedText
  | InterpolatedPoly
  | InterpolatedHighlight;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Catmull-Rom spline for a single scalar value given 4 control points
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

// Binary search: find index of last keyframe with tMs <= target
function findBracketIndex(keyframes: ClipKeyframe[], tMs: number): number {
  let lo = 0;
  let hi = keyframes.length - 1;
  if (tMs <= keyframes[0].tMs) return 0;
  if (tMs >= keyframes[hi].tMs) return hi;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].tMs <= tMs) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Per-type interpolators
// ---------------------------------------------------------------------------

function interpolateBox(a: BoxKeyframe, b: BoxKeyframe, t: number, useCubic: boolean, prev: BoxKeyframe | null, next: BoxKeyframe | null): InterpolatedBox {
  if (useCubic && prev && next) {
    return {
      type: 'box',
      x: catmullRom(prev.x, a.x, b.x, next.x, t),
      y: catmullRom(prev.y, a.y, b.y, next.y, t),
      w: catmullRom(prev.w, a.w, b.w, next.w, t),
      h: catmullRom(prev.h, a.h, b.h, next.h, t),
    };
  }
  return {
    type: 'box',
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
  };
}

function interpolateCircle(a: CircleKeyframe, b: CircleKeyframe, t: number, useCubic: boolean, prev: CircleKeyframe | null, next: CircleKeyframe | null): InterpolatedCircle {
  if (useCubic && prev && next) {
    return {
      type: 'circle',
      cx: catmullRom(prev.cx, a.cx, b.cx, next.cx, t),
      cy: catmullRom(prev.cy, a.cy, b.cy, next.cy, t),
      rx: catmullRom(prev.rx, a.rx, b.rx, next.rx, t),
      ry: catmullRom(prev.ry, a.ry, b.ry, next.ry, t),
    };
  }
  return {
    type: 'circle',
    cx: lerp(a.cx, b.cx, t),
    cy: lerp(a.cy, b.cy, t),
    rx: lerp(a.rx, b.rx, t),
    ry: lerp(a.ry, b.ry, t),
  };
}

function interpolateShadow(a: ShadowKeyframe, b: ShadowKeyframe, t: number, useCubic: boolean, prev: ShadowKeyframe | null, next: ShadowKeyframe | null): InterpolatedShadow {
  if (useCubic && prev && next) {
    return {
      type: 'shadow',
      x: catmullRom(prev.x, a.x, b.x, next.x, t),
      y: catmullRom(prev.y, a.y, b.y, next.y, t),
      r: catmullRom(prev.r, a.r, b.r, next.r, t),
      rotation: catmullRom(prev.rotation, a.rotation, b.rotation, next.rotation, t),
      spreadDeg: catmullRom(prev.spreadDeg, a.spreadDeg, b.spreadDeg, next.spreadDeg, t),
    };
  }
  return {
    type: 'shadow',
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    r: lerp(a.r, b.r, t),
    rotation: lerp(a.rotation, b.rotation, t),
    spreadDeg: lerp(a.spreadDeg, b.spreadDeg, t),
  };
}

function interpolateArrow(a: ArrowKeyframe, b: ArrowKeyframe, t: number, useCubic: boolean, prev: ArrowKeyframe | null, next: ArrowKeyframe | null): InterpolatedArrow {
  if (useCubic && prev && next) {
    return {
      type: 'arrow',
      x1: catmullRom(prev.x1, a.x1, b.x1, next.x1, t),
      y1: catmullRom(prev.y1, a.y1, b.y1, next.y1, t),
      x2: catmullRom(prev.x2, a.x2, b.x2, next.x2, t),
      y2: catmullRom(prev.y2, a.y2, b.y2, next.y2, t),
    };
  }
  return {
    type: 'arrow',
    x1: lerp(a.x1, b.x1, t),
    y1: lerp(a.y1, b.y1, t),
    x2: lerp(a.x2, b.x2, t),
    y2: lerp(a.y2, b.y2, t),
  };
}

function interpolateLob(a: LobKeyframe, b: LobKeyframe, t: number, useCubic: boolean, prev: LobKeyframe | null, next: LobKeyframe | null): InterpolatedLob {
  if (useCubic && prev && next) {
    return {
      type: 'lob',
      x1: catmullRom(prev.x1, a.x1, b.x1, next.x1, t),
      y1: catmullRom(prev.y1, a.y1, b.y1, next.y1, t),
      cx: catmullRom(prev.cx, a.cx, b.cx, next.cx, t),
      cy: catmullRom(prev.cy, a.cy, b.cy, next.cy, t),
      x2: catmullRom(prev.x2, a.x2, b.x2, next.x2, t),
      y2: catmullRom(prev.y2, a.y2, b.y2, next.y2, t),
    };
  }
  return {
    type: 'lob',
    x1: lerp(a.x1, b.x1, t),
    y1: lerp(a.y1, b.y1, t),
    cx: lerp(a.cx, b.cx, t),
    cy: lerp(a.cy, b.cy, t),
    x2: lerp(a.x2, b.x2, t),
    y2: lerp(a.y2, b.y2, t),
  };
}

function interpolateText(a: TextKeyframe, b: TextKeyframe, t: number, useCubic: boolean, prev: TextKeyframe | null, next: TextKeyframe | null): InterpolatedText {
  if (useCubic && prev && next) {
    return {
      type: 'text',
      x: catmullRom(prev.x, a.x, b.x, next.x, t),
      y: catmullRom(prev.y, a.y, b.y, next.y, t),
    };
  }
  return {
    type: 'text',
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
  };
}

// Poly and BoxQuad: always linear, per-vertex
function interpolatePoly(a: PolyKeyframe, b: PolyKeyframe, t: number): InterpolatedPoly {
  const n = Math.min(a.points.length, b.points.length);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    pts.push([lerp(a.points[i][0], b.points[i][0], t), lerp(a.points[i][1], b.points[i][1], t)]);
  }
  return { type: 'poly', points: pts };
}

function interpolateHighlight(a: HighlightKeyframe, b: HighlightKeyframe, t: number, useCubic: boolean, prev: HighlightKeyframe | null, next: HighlightKeyframe | null): InterpolatedHighlight {
  if (useCubic && prev && next) {
    return {
      type: 'highlight',
      cx: catmullRom(prev.cx, a.cx, b.cx, next.cx, t),
      cy: catmullRom(prev.cy, a.cy, b.cy, next.cy, t),
      radius: catmullRom(prev.radius, a.radius, b.radius, next.radius, t),
    };
  }
  return {
    type: 'highlight',
    cx: lerp(a.cx, b.cx, t),
    cy: lerp(a.cy, b.cy, t),
    radius: lerp(a.radius, b.radius, t),
  };
}

// ---------------------------------------------------------------------------
// Main interpolation function
// ---------------------------------------------------------------------------

/**
 * Interpolate keyframes at a given clip-relative time.
 *
 * @param keyframes  Sorted by tMs ascending
 * @param tMs        Current clip-relative time in ms
 * @param type       Annotation type
 * @param fps        Video fps (used to decide linear vs cubic)
 * @returns Interpolated properties, or null if hidden
 */
export function interpolateKeyframes(
  keyframes: ClipKeyframe[],
  tMs: number,
  type: ClipAnnotationType,
  fps: number = 30,
): InterpolatedKeyframe | null {
  if (!keyframes || keyframes.length === 0) return null;

  // Single keyframe: clamp
  if (keyframes.length === 1) {
    const kf = keyframes[0];
    if (kf.visible === false) return null;
    return clampToKeyframe(kf, type);
  }

  // Before first keyframe → clamp to first
  if (tMs <= keyframes[0].tMs) {
    const kf = keyframes[0];
    if (kf.visible === false) return null;
    return clampToKeyframe(kf, type);
  }

  // After last keyframe → clamp to last
  if (tMs >= keyframes[keyframes.length - 1].tMs) {
    const kf = keyframes[keyframes.length - 1];
    if (kf.visible === false) return null;
    return clampToKeyframe(kf, type);
  }

  // Find bracketing pair
  const i = findBracketIndex(keyframes, tMs);
  const a = keyframes[i];
  const b = keyframes[i + 1];

  // If either bracket has visible: false → hidden
  if (a.visible === false || b.visible === false) return null;

  // Compute t in [0,1] within the bracket
  const span = b.tMs - a.tMs;
  const t = span > 0 ? (tMs - a.tMs) / span : 0;

  // Determine interpolation mode: cubic if bracket gap > 2 frames
  const frameDuration = 1000 / fps;
  const useCubic = span > frameDuration * 2;

  // Get prev/next for Catmull-Rom (may be null)
  const prev = i > 0 ? keyframes[i - 1] : null;
  const next = i + 2 < keyframes.length ? keyframes[i + 2] : null;

  switch (type) {
    case 'box':
      // BoxQuad keyframes have .points array; plain BoxKeyframe has x/y/w/h
      if ('points' in a && 'points' in b) {
        return interpolatePoly(a as PolyKeyframe, b as PolyKeyframe, t);
      }
      return interpolateBox(
        a as BoxKeyframe, b as BoxKeyframe, t, useCubic,
        prev as BoxKeyframe | null, next as BoxKeyframe | null,
      );
    case 'circle':
      return interpolateCircle(
        a as CircleKeyframe, b as CircleKeyframe, t, useCubic,
        prev as CircleKeyframe | null, next as CircleKeyframe | null,
      );
    case 'shadow':
      return interpolateShadow(
        a as ShadowKeyframe, b as ShadowKeyframe, t, useCubic,
        prev as ShadowKeyframe | null, next as ShadowKeyframe | null,
      );
    case 'arrow':
      return interpolateArrow(
        a as ArrowKeyframe, b as ArrowKeyframe, t, useCubic,
        prev as ArrowKeyframe | null, next as ArrowKeyframe | null,
      );
    case 'lob':
      return interpolateLob(
        a as LobKeyframe, b as LobKeyframe, t, useCubic,
        prev as LobKeyframe | null, next as LobKeyframe | null,
      );
    case 'text':
      return interpolateText(
        a as TextKeyframe, b as TextKeyframe, t, useCubic,
        prev as TextKeyframe | null, next as TextKeyframe | null,
      );
    case 'poly':
      return interpolatePoly(a as PolyKeyframe, b as PolyKeyframe, t);
    case 'highlight':
      return interpolateHighlight(
        a as HighlightKeyframe, b as HighlightKeyframe, t, useCubic,
        prev as HighlightKeyframe | null, next as HighlightKeyframe | null,
      );
    default:
      return null;
  }
}

export function interpolateAnnotationAtTime(
  annotation: ClipAnnotation,
  tMs: number,
  fps: number = 30,
  clipDurationMs: number = annotation.keyframes[annotation.keyframes.length - 1]?.tMs ?? 0,
): InterpolatedKeyframe | null {
  if (!annotation.keyframes || annotation.keyframes.length === 0) return null;

  const exact = annotation.keyframes.find((keyframe) => keyframe.tMs === tMs);
  if (exact) {
    if (exact.visible === false) return null;
    return clampToKeyframe(exact, annotation.type);
  }

  if (isTimeWithinHiddenSpan(getHiddenSpans(annotation, clipDurationMs, fps), tMs)) {
    return null;
  }

  return interpolateKeyframes(annotation.keyframes, tMs, annotation.type, fps);
}

// ---------------------------------------------------------------------------
// Clamp helper: extract static properties from a single keyframe
// ---------------------------------------------------------------------------

function clampToKeyframe(kf: ClipKeyframe, type: ClipAnnotationType): InterpolatedKeyframe | null {
  switch (type) {
    case 'box':
      if ('points' in kf) {
        return { type: 'poly', points: (kf as PolyKeyframe).points.map(p => [...p] as [number, number]) };
      }
      return { type: 'box', x: (kf as BoxKeyframe).x, y: (kf as BoxKeyframe).y, w: (kf as BoxKeyframe).w, h: (kf as BoxKeyframe).h };
    case 'circle':
      return { type: 'circle', cx: (kf as CircleKeyframe).cx, cy: (kf as CircleKeyframe).cy, rx: (kf as CircleKeyframe).rx, ry: (kf as CircleKeyframe).ry };
    case 'shadow':
      return {
        type: 'shadow',
        x: (kf as ShadowKeyframe).x,
        y: (kf as ShadowKeyframe).y,
        r: (kf as ShadowKeyframe).r,
        rotation: (kf as ShadowKeyframe).rotation,
        spreadDeg: (kf as ShadowKeyframe).spreadDeg,
      };
    case 'arrow':
      return { type: 'arrow', x1: (kf as ArrowKeyframe).x1, y1: (kf as ArrowKeyframe).y1, x2: (kf as ArrowKeyframe).x2, y2: (kf as ArrowKeyframe).y2 };
    case 'lob':
      return {
        type: 'lob',
        x1: (kf as LobKeyframe).x1,
        y1: (kf as LobKeyframe).y1,
        cx: (kf as LobKeyframe).cx,
        cy: (kf as LobKeyframe).cy,
        x2: (kf as LobKeyframe).x2,
        y2: (kf as LobKeyframe).y2,
      };
    case 'text':
      return { type: 'text', x: (kf as TextKeyframe).x, y: (kf as TextKeyframe).y };
    case 'poly':
      return { type: 'poly', points: (kf as PolyKeyframe).points.map(p => [...p] as [number, number]) };
    case 'highlight':
      return { type: 'highlight', cx: (kf as HighlightKeyframe).cx, cy: (kf as HighlightKeyframe).cy, radius: (kf as HighlightKeyframe).radius };
    default:
      return null;
  }
}

// Re-export helpers for testing
export { lerp, catmullRom, findBracketIndex };
