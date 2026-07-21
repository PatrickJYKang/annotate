// ---------------------------------------------------------------------------
// Bbox → annotation geometry converters
// See plans/post-mvp/clips/clips-feature.md §3 (Phase 3)
//
// Converts sidecar tracking bboxes [x, y, w, h] to clip annotation
// keyframe geometry for each annotation type.
// ---------------------------------------------------------------------------

import type {
  ClipAnnotationType,
  ClipKeyframe,
  ClipKeyframeProvenance,
} from '../types/clip';
import { timestampMsToNearestFrame } from './frameMath';

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
  const radius = (bbox.w / 2 + bbox.h / 2) / 2;
  const radiusY = radius * 0.35;
  return {
    cx: bbox.x + bbox.w / 2,
    // Anchor tracked highlights to the player's feet rather than the bbox centre.
    cy: bbox.y + bbox.h - radiusY,
    radius,
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

export interface RawTrackingKeyframe {
  tMs: number;        // absolute video ms from sidecar
  bbox: Bbox;
  visible?: boolean;
}

/** Convert sidecar timestamps directly onto the owning video's absolute frame axis. */
export function convertTrackingKeyframes(
  rawKeyframes: RawTrackingKeyframe[],
  annotationType: ClipAnnotationType,
  videoFps: number,
  frameCount: number,
): ClipKeyframe[] {
  const byFrame = new Map<number, ClipKeyframe>();

  for (const raw of rawKeyframes) {
    const frame = timestampMsToNearestFrame(raw.tMs, videoFps, frameCount);
    const provenance: ClipKeyframeProvenance = raw.visible === false ? 'lost' : 'tracked';
    const base = {
      frame,
      provenance,
      ...(raw.visible === false ? { visible: false } : {}),
    };

    let keyframe: ClipKeyframe;
    switch (annotationType) {
      case 'box':
        keyframe = { ...base, ...bboxToBox(raw.bbox) } as ClipKeyframe;
        break;
      case 'circle':
        keyframe = { ...base, ...bboxToCircle(raw.bbox) } as ClipKeyframe;
        break;
      case 'arrow':
        keyframe = { ...base, ...bboxToArrow(raw.bbox) } as ClipKeyframe;
        break;
      case 'highlight':
        keyframe = { ...base, ...bboxToHighlight(raw.bbox) } as ClipKeyframe;
        break;
      case 'text':
        keyframe = { ...base, x: raw.bbox.x, y: raw.bbox.y } as ClipKeyframe;
        break;
      case 'poly': {
        const { x, y, w, h } = raw.bbox;
        keyframe = {
          ...base,
          points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
        } as ClipKeyframe;
        break;
      }
      default:
        keyframe = { ...base, ...bboxToBox(raw.bbox) } as ClipKeyframe;
    }

    // Sparse sidecar samples can round to one source frame; the later sample
    // is the closest statement of tracker state for that canonical frame.
    byFrame.set(frame, keyframe);
  }

  return [...byFrame.values()].sort((left, right) => left.frame - right.frame);
}
