// ---------------------------------------------------------------------------
// Bbox → annotation geometry converters
// See plans/post-mvp/clips/clips-feature.md §3 (Phase 3)
//
// Converts sidecar tracking bboxes [x, y, w, h] to clip annotation
// keyframe geometry for each annotation type.
// ---------------------------------------------------------------------------

import type {
  ClipAnnotationType,
  BoxKeyframe,
  CircleKeyframe,
  ArrowKeyframe,
  HighlightKeyframe,
  ClipKeyframe,
  ClipKeyframeProvenance,
} from '../types/clip';

export type Bbox = { x: number; y: number; w: number; h: number };

// ---------------------------------------------------------------------------
// Per-type converters
// ---------------------------------------------------------------------------

export function bboxToBox(bbox: Bbox): { x: number; y: number; w: number; h: number } {
  return { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h };
}

export function bboxToCircle(bbox: Bbox): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: bbox.x + bbox.w / 2,
    cy: bbox.y + bbox.h / 2,
    rx: bbox.w / 2,
    ry: bbox.h / 2,
  };
}

export function bboxToHighlight(bbox: Bbox): { cx: number; cy: number; radius: number } {
  return {
    cx: bbox.x + bbox.w / 2,
    cy: bbox.y + bbox.h / 2,
    radius: (bbox.w / 2 + bbox.h / 2) / 2,
  };
}

export function bboxToArrow(bbox: Bbox): { x1: number; y1: number; x2: number; y2: number } {
  const cy = bbox.y + bbox.h / 2;
  return {
    x1: bbox.x,
    y1: cy,
    x2: bbox.x + bbox.w,
    y2: cy,
  };
}

// ---------------------------------------------------------------------------
// Batch converter: raw sidecar keyframes → ClipKeyframe[]
// ---------------------------------------------------------------------------

export interface RawTrackingKeyframe {
  tMs: number;        // absolute video ms from sidecar
  bbox: Bbox;
  visible?: boolean;
}

/**
 * Convert sidecar tracking keyframes to typed ClipKeyframes.
 *
 * @param rawKeyframes  Keyframes from sidecar (absolute ms)
 * @param annotationType  Target annotation type
 * @param clipStartMs  Clip start time in absolute video ms (for converting to clip-relative)
 * @returns ClipKeyframe[] sorted by tMs (clip-relative)
 */
export function convertTrackingKeyframes(
  rawKeyframes: RawTrackingKeyframe[],
  annotationType: ClipAnnotationType,
  clipStartMs: number,
): ClipKeyframe[] {
  return rawKeyframes.map((raw): ClipKeyframe => {
    const tMs = raw.tMs - clipStartMs;
    const provenance: ClipKeyframeProvenance = raw.visible === false ? 'lost' : 'tracked';
    const base = {
      tMs,
      provenance,
      ...(raw.visible === false ? { visible: false } : {}),
    };

    switch (annotationType) {
      case 'box': {
        const g = bboxToBox(raw.bbox);
        return { ...base, ...g } as BoxKeyframe;
      }
      case 'circle': {
        const g = bboxToCircle(raw.bbox);
        return { ...base, ...g } as CircleKeyframe;
      }
      case 'arrow': {
        const g = bboxToArrow(raw.bbox);
        return { ...base, ...g } as ArrowKeyframe;
      }
      case 'highlight': {
        const g = bboxToHighlight(raw.bbox);
        return { ...base, ...g } as HighlightKeyframe;
      }
      case 'text': {
        // Text keyframes only need position (top-left of bbox)
        return { ...base, x: raw.bbox.x, y: raw.bbox.y };
      }
      case 'poly': {
        // Poly from bbox → 4 corners
        const { x, y, w, h } = raw.bbox;
        return { ...base, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [number, number][] };
      }
      default:
        return { ...base, x: raw.bbox.x, y: raw.bbox.y, w: raw.bbox.w, h: raw.bbox.h } as BoxKeyframe;
    }
  }).sort((a, b) => a.tMs - b.tMs);
}
