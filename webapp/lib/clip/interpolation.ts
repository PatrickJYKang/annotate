// ---------------------------------------------------------------------------
// Clip keyframe interpolation engine
// See plans/post-mvp/clips/clips-feature.md §3 (Phase 3)
// ---------------------------------------------------------------------------

import type {
  ArrowKeyframe,
  BoxKeyframe,
  CircleKeyframe,
  ClipAnnotation,
  ClipAnnotationType,
  ClipKeyframe,
  HighlightKeyframe,
  LobKeyframe,
  PolyKeyframe,
  ShadowKeyframe,
  TextKeyframe,
} from '../types/clip';
import type { FrameBoundary, VideoFrame } from './frameMath';
import {
  getHiddenSpans,
  isAnnotationVisible,
  isFrameWithinHiddenSpan,
} from './trackingState';

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

function findFrameBracketIndex(keyframes: ClipKeyframe[], frame: VideoFrame): number {
  let low = 0;
  let high = keyframes.length - 1;
  if (frame <= keyframes[0].frame) return 0;
  if (frame >= keyframes[high].frame) return high;
  while (low < high - 1) {
    const middle = (low + high) >> 1;
    if (keyframes[middle].frame <= frame) low = middle;
    else high = middle;
  }
  return low;
}

/** Resolve absolute-frame keyframes without converting the stored axis to time. */
export function interpolateKeyframes(
  keyframes: ClipKeyframe[],
  frame: VideoFrame,
  type: ClipAnnotationType,
): InterpolatedKeyframe | null {
  if (keyframes.length === 0) return null;
  const clamp = (keyframe: ClipKeyframe) => (
    keyframe.visible === false
      ? null
      : clampToKeyframe(keyframe as unknown as ClipKeyframe, type)
  );

  if (keyframes.length === 1 || frame <= keyframes[0].frame) return clamp(keyframes[0]);
  if (frame >= keyframes[keyframes.length - 1].frame) return clamp(keyframes[keyframes.length - 1]);

  const index = findFrameBracketIndex(keyframes, frame);
  const left = keyframes[index];
  const right = keyframes[index + 1];
  if (left.visible === false || right.visible === false) return null;

  const span = right.frame - left.frame;
  const progress = span > 0 ? (frame - left.frame) / span : 0;
  const useCubic = span > 2;
  const previous = index > 0 ? keyframes[index - 1] : null;
  const next = index + 2 < keyframes.length ? keyframes[index + 2] : null;

  switch (type) {
    case 'box':
      if ('points' in left && 'points' in right) {
        return interpolatePoly(
          left as unknown as PolyKeyframe,
          right as unknown as PolyKeyframe,
          progress,
        );
      }
      return interpolateBox(
        left as unknown as BoxKeyframe,
        right as unknown as BoxKeyframe,
        progress,
        useCubic,
        previous as unknown as BoxKeyframe | null,
        next as unknown as BoxKeyframe | null,
      );
    case 'circle':
      return interpolateCircle(
        left as unknown as CircleKeyframe,
        right as unknown as CircleKeyframe,
        progress,
        useCubic,
        previous as unknown as CircleKeyframe | null,
        next as unknown as CircleKeyframe | null,
      );
    case 'shadow':
      return interpolateShadow(
        left as unknown as ShadowKeyframe,
        right as unknown as ShadowKeyframe,
        progress,
        useCubic,
        previous as unknown as ShadowKeyframe | null,
        next as unknown as ShadowKeyframe | null,
      );
    case 'arrow':
      return interpolateArrow(
        left as unknown as ArrowKeyframe,
        right as unknown as ArrowKeyframe,
        progress,
        useCubic,
        previous as unknown as ArrowKeyframe | null,
        next as unknown as ArrowKeyframe | null,
      );
    case 'lob':
      return interpolateLob(
        left as unknown as LobKeyframe,
        right as unknown as LobKeyframe,
        progress,
        useCubic,
        previous as unknown as LobKeyframe | null,
        next as unknown as LobKeyframe | null,
      );
    case 'text':
      return interpolateText(
        left as unknown as TextKeyframe,
        right as unknown as TextKeyframe,
        progress,
        useCubic,
        previous as unknown as TextKeyframe | null,
        next as unknown as TextKeyframe | null,
      );
    case 'poly':
      return interpolatePoly(
        left as unknown as PolyKeyframe,
        right as unknown as PolyKeyframe,
        progress,
      );
    case 'highlight':
      return interpolateHighlight(
        left as unknown as HighlightKeyframe,
        right as unknown as HighlightKeyframe,
        progress,
        useCubic,
        previous as unknown as HighlightKeyframe | null,
        next as unknown as HighlightKeyframe | null,
      );
    default:
      return null;
  }
}

export function interpolateAnnotation(
  annotation: ClipAnnotation,
  frame: VideoFrame,
  clipEndFrame: FrameBoundary,
): InterpolatedKeyframe | null {
  if (annotation.keyframes.length === 0) return null;
  if (!isAnnotationVisible(annotation, frame)) return null;

  const exactIndex = findFrameBracketIndex(annotation.keyframes, frame);
  const exact = annotation.keyframes[exactIndex]?.frame === frame
    ? annotation.keyframes[exactIndex]
    : null;
  if (exact) {
    if (exact.visible === false) return null;
    return clampToKeyframe(exact as unknown as ClipKeyframe, annotation.type);
  }

  if (isFrameWithinHiddenSpan(getHiddenSpans(annotation, clipEndFrame), frame)) {
    return null;
  }
  return interpolateKeyframes(annotation.keyframes, frame, annotation.type);
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
export { lerp, catmullRom, findFrameBracketIndex };
