import type { AnnotationsV1, ExportShape } from '../export/d7Render';
import { makeId } from '../annotate/shapeRendering';
import {
  applyHomography,
  computeHomographyFromUnitSquareToQuad,
  ellipsePlaneToImagePoints,
  rectPlaneToImagePoints,
} from '../annotate/homography';
import type { ClipAnnotation, ClipAnnotationStyle, ClipKeyframe } from '../types/clip';

type ImportResult = {
  annotations: ClipAnnotation[];
  skipped: number;
};

function toPointPairs(points: number[] | undefined): [number, number][] {
  if (!Array.isArray(points) || points.length < 2) return [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = Number(points[i]);
    const y = Number(points[i + 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      out.push([x, y]);
    }
  }
  return out;
}

function normalizeClipStyle(shape: ExportShape): ClipAnnotationStyle {
  return {
    stroke: shape.style?.stroke,
    fill: shape.style?.fill,
    fillOpacity: shape.style?.fillOpacity,
    strokeWidth: shape.style?.strokeWidth,
    strokePattern: shape.style?.strokePattern,
    fontSize: shape.style?.fontSize,
    fontFamily: shape.style?.fontFamily,
    textHighlight: (shape.style as ClipAnnotationStyle | undefined)?.textHighlight,
  };
}

function buildPerspectiveMatrix(document: AnnotationsV1): number[] | null {
  const quad = document.perspective?.quad;
  if (!Array.isArray(quad) || quad.length !== 4) return null;
  const normalized = quad.every(
    (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y),
  );
  if (!normalized) return null;
  return computeHomographyFromUnitSquareToQuad(quad).H;
}

function projectPlaneRect(shape: ExportShape, H: number[]): [number, number][] {
  const plane = shape.plane!;
  return toPointPairs(rectPlaneToImagePoints(H, plane.cx, plane.cy, plane.w ?? 0, plane.h ?? 0));
}

function projectPlaneEllipse(shape: ExportShape, H: number[], fallbackRyScale = 1): [number, number][] {
  const plane = shape.plane!;
  const rx = plane.rx ?? plane.r ?? 0;
  const ry = plane.ry ?? plane.r ?? (rx * fallbackRyScale);
  return toPointPairs(ellipsePlaneToImagePoints(H, plane.cx, plane.cy, rx, ry, 32));
}

function projectPlanePoint(shape: ExportShape, H: number[]): { x: number; y: number } | null {
  const plane = shape.plane!;
  if (!Number.isFinite(plane.cx) || !Number.isFinite(plane.cy)) return null;
  return applyHomography(H, plane.cx, plane.cy);
}

function buildKeyframeFromShape(
  shape: ExportShape,
  tMs: number,
  perspectiveMatrix: number[] | null,
): Pick<ClipAnnotation, 'type' | 'coordMode' | 'text' | 'closed'> & { keyframe: ClipKeyframe } | null {
  if (shape.plane && !perspectiveMatrix) {
    return null;
  }

  switch (shape.type) {
    case 'box': {
      if (shape.plane && perspectiveMatrix) {
        const points = projectPlaneRect(shape, perspectiveMatrix);
        if (points.length < 3) return null;
        return {
          type: 'poly',
          coordMode: 'image',
          closed: true,
          keyframe: { tMs, points },
        };
      }
      if (!Number.isFinite(shape.x) || !Number.isFinite(shape.y) || !Number.isFinite(shape.w) || !Number.isFinite(shape.h)) {
        return null;
      }
      return {
        type: 'box',
        coordMode: 'image',
        keyframe: { tMs, x: shape.x, y: shape.y, w: shape.w!, h: shape.h! },
      };
    }
    case 'circle': {
      if (shape.plane && perspectiveMatrix) {
        const points = projectPlaneEllipse(shape, perspectiveMatrix);
        if (points.length < 3) return null;
        return {
          type: 'poly',
          coordMode: 'image',
          closed: true,
          keyframe: { tMs, points },
        };
      }
      const rx = shape.rx ?? shape.r;
      const ry = shape.ry ?? shape.r;
      if (!Number.isFinite(shape.x) || !Number.isFinite(shape.y) || !Number.isFinite(rx) || !Number.isFinite(ry)) {
        return null;
      }
      return {
        type: 'circle',
        coordMode: 'image',
        keyframe: { tMs, cx: shape.x, cy: shape.y, rx: rx!, ry: ry! },
      };
    }
    case 'arrow': {
      const points = toPointPairs(shape.points);
      if (points.length < 2) return null;
      return {
        type: 'arrow',
        coordMode: 'image',
        keyframe: {
          tMs,
          x1: points[0][0],
          y1: points[0][1],
          x2: points[1][0],
          y2: points[1][1],
        },
      };
    }
    case 'text': {
      if (shape.plane && perspectiveMatrix) {
        const point = projectPlanePoint(shape, perspectiveMatrix);
        if (!point) return null;
        return {
          type: 'text',
          coordMode: 'image',
          text: shape.text ?? '',
          keyframe: { tMs, x: point.x, y: point.y },
        };
      }
      if (!Number.isFinite(shape.x) || !Number.isFinite(shape.y)) return null;
      return {
        type: 'text',
        coordMode: 'image',
        text: shape.text ?? '',
        keyframe: { tMs, x: shape.x, y: shape.y },
      };
    }
    case 'poly': {
      const points = toPointPairs(shape.points);
      if (points.length < 2) return null;
      return {
        type: 'poly',
        coordMode: 'image',
        closed: shape.closed !== false,
        keyframe: { tMs, points },
      };
    }
    case 'highlight': {
      if (shape.plane && perspectiveMatrix) {
        const points = projectPlaneEllipse(shape, perspectiveMatrix, 0.35);
        if (points.length < 3) return null;
        return {
          type: 'poly',
          coordMode: 'image',
          closed: true,
          keyframe: { tMs, points },
        };
      }
      const radius = shape.rx ?? shape.r;
      if (!Number.isFinite(shape.x) || !Number.isFinite(shape.y) || !Number.isFinite(radius)) {
        return null;
      }
      return {
        type: 'highlight',
        coordMode: 'image',
        keyframe: { tMs, cx: shape.x, cy: shape.y, radius: radius! },
      };
    }
    default:
      return null;
  }
}

export function importStillDocumentToClip(
  document: AnnotationsV1,
  clipFrameMs: number,
): ImportResult {
  const perspectiveMatrix = buildPerspectiveMatrix(document);
  const annotations: ClipAnnotation[] = [];
  let skipped = 0;
  const frameMs = Number.isFinite(clipFrameMs) ? clipFrameMs : 0;

  for (const shape of document.shapes || []) {
    if ((shape as any)?._temp) continue;
    if (typeof shape.id === 'string' && shape.id.startsWith('_temp_')) continue;

    const built = buildKeyframeFromShape(shape, frameMs, perspectiveMatrix);
    if (!built) {
      skipped += 1;
      continue;
    }

    annotations.push({
      id: makeId(),
      type: built.type,
      coordMode: built.coordMode,
      // Imported still annotations are user-authored starting points, so they
      // remain manual until tracking/correction workflows take over later.
      source: 'manual',
      text: built.text,
      closed: built.closed,
      style: normalizeClipStyle(shape),
      keyframes: [built.keyframe],
    });
  }

  return { annotations, skipped };
}
