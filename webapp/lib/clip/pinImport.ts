import {
  applyHomography,
  computeHomographyFromUnitSquareToQuad,
  ellipsePlaneToImagePoints,
  rectPlaneToImagePoints,
} from '../annotate/homography';
import { makeId } from '../annotate/shapeRendering';
import type { Annotations } from '../types/annotations';
import type { ClipAnnotationStyle, ClipAnnotation, ClipKeyframe } from '../types/clip';
import type { ExportShape } from '../export/d7Render';
import type { VideoFrame } from './frameMath';

export interface PinImportResult {
  annotations: ClipAnnotation[];
  skipped: number;
}

export interface AppliedPinImportResult {
  annotations: ClipAnnotation[];
  existingAtFrameCount: number;
  importedCount: number;
  resolution: 'append';
}

type BuiltShape = Pick<
  ClipAnnotation,
  'type' | 'coordMode' | 'text' | 'closed' | 'vertexRefs'
> & {
  sourceShapeId: string;
  geometry: Record<string, unknown> & { provenance: 'manual' };
};

function toPointPairs(points: number[] | undefined): [number, number][] {
  if (!Array.isArray(points) || points.length < 2) return [];
  const pairs: [number, number][] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = Number(points[index]);
    const y = Number(points[index + 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]);
  }
  return pairs;
}

function normalizeStyle(shape: ExportShape): ClipAnnotationStyle {
  return {
    stroke: shape.style?.stroke,
    fill: shape.style?.fill,
    fillOpacity: shape.style?.fillOpacity,
    strokeWidth: shape.style?.strokeWidth,
    strokePattern: shape.style?.strokePattern,
    fontSize: shape.style?.fontSize,
    fontFamily: shape.style?.fontFamily,
    textHighlight: shape.style?.textHighlight,
  };
}

function perspectiveMatrix(document: Annotations): number[] | null {
  const quad = document.perspective?.quad;
  if (!Array.isArray(quad) || quad.length !== 4) return null;
  if (!quad.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  return computeHomographyFromUnitSquareToQuad(quad).H;
}

function projectRect(shape: ExportShape, matrix: number[]): [number, number][] {
  const plane = shape.plane!;
  return toPointPairs(rectPlaneToImagePoints(
    matrix,
    plane.cx,
    plane.cy,
    plane.w ?? 0,
    plane.h ?? 0,
  ));
}

function projectEllipse(
  shape: ExportShape,
  matrix: number[],
  fallbackRyScale = 1,
): [number, number][] {
  const plane = shape.plane!;
  const rx = plane.rx ?? plane.r ?? 0;
  const ry = plane.ry ?? plane.r ?? rx * fallbackRyScale;
  return toPointPairs(ellipsePlaneToImagePoints(matrix, plane.cx, plane.cy, rx, ry, 32));
}

function buildShape(shape: ExportShape, matrix: number[] | null): BuiltShape | null {
  if (shape.plane && !matrix) return null;
  switch (shape.type) {
    case 'box': {
      if (shape.plane && matrix) {
        const points = projectRect(shape, matrix);
        return points.length >= 3 ? {
          type: 'poly',
          coordMode: 'image',
          closed: true,
          sourceShapeId: shape.id,
          geometry: { points, provenance: 'manual' },
        } : null;
      }
      if (![shape.x, shape.y, shape.w, shape.h].every(Number.isFinite)) return null;
      return {
        type: 'box',
        coordMode: 'image',
        sourceShapeId: shape.id,
        geometry: { x: shape.x, y: shape.y, w: shape.w!, h: shape.h!, provenance: 'manual' },
      };
    }
    case 'circle': {
      if (shape.plane && matrix) {
        const points = projectEllipse(shape, matrix);
        return points.length >= 3 ? {
          type: 'poly',
          coordMode: 'image',
          closed: true,
          sourceShapeId: shape.id,
          geometry: { points, provenance: 'manual' },
        } : null;
      }
      const rx = shape.rx ?? shape.r;
      const ry = shape.ry ?? shape.r;
      if (![shape.x, shape.y, rx, ry].every(Number.isFinite)) return null;
      return {
        type: 'circle',
        coordMode: 'image',
        sourceShapeId: shape.id,
        geometry: { cx: shape.x, cy: shape.y, rx: rx!, ry: ry!, provenance: 'manual' },
      };
    }
    case 'shadow': {
      if (shape.plane) return null;
      const radius = shape.r ?? shape.rx;
      if (![shape.x, shape.y, radius].every(Number.isFinite)) return null;
      return {
        type: 'shadow',
        coordMode: 'image',
        sourceShapeId: shape.id,
        vertexRefs: shape.vertexRefs?.slice(0, 1),
        geometry: {
          x: shape.x,
          y: shape.y,
          r: radius!,
          rotation: Number.isFinite(shape.rotation) ? shape.rotation! : 0,
          spreadDeg: Number.isFinite(shape.spreadDeg) ? shape.spreadDeg! : 42,
          provenance: 'manual',
        },
      };
    }
    case 'arrow': {
      const points = toPointPairs(shape.points);
      if (points.length < 2) return null;
      return {
        type: 'arrow',
        coordMode: 'image',
        sourceShapeId: shape.id,
        vertexRefs: shape.vertexRefs?.slice(0, 2),
        geometry: {
          x1: points[0][0],
          y1: points[0][1],
          x2: points[1][0],
          y2: points[1][1],
          provenance: 'manual',
        },
      };
    }
    case 'lob': {
      if (shape.plane) return null;
      const points = toPointPairs(shape.points);
      if (points.length < 3) return null;
      return {
        type: 'lob',
        coordMode: 'image',
        sourceShapeId: shape.id,
        vertexRefs: shape.vertexRefs?.slice(0, 2),
        geometry: {
          x1: points[0][0],
          y1: points[0][1],
          cx: points[1][0],
          cy: points[1][1],
          x2: points[2][0],
          y2: points[2][1],
          provenance: 'manual',
        },
      };
    }
    case 'text': {
      if (shape.plane && matrix) {
        const point = applyHomography(matrix, shape.plane.cx, shape.plane.cy);
        return {
          type: 'text',
          coordMode: 'image',
          text: shape.text ?? '',
          sourceShapeId: shape.id,
          geometry: { x: point.x, y: point.y, provenance: 'manual' },
        };
      }
      if (![shape.x, shape.y].every(Number.isFinite)) return null;
      return {
        type: 'text',
        coordMode: 'image',
        text: shape.text ?? '',
        sourceShapeId: shape.id,
        geometry: { x: shape.x, y: shape.y, provenance: 'manual' },
      };
    }
    case 'poly': {
      const points = toPointPairs(shape.points);
      if (points.length < 2) return null;
      return {
        type: 'poly',
        coordMode: 'image',
        closed: shape.closed !== false,
        sourceShapeId: shape.id,
        vertexRefs: shape.vertexRefs?.slice(0, points.length),
        geometry: { points, provenance: 'manual' },
      };
    }
    case 'highlight': {
      if (shape.plane && matrix) {
        const points = projectEllipse(shape, matrix, 0.35);
        return points.length >= 3 ? {
          type: 'poly',
          coordMode: 'image',
          closed: true,
          sourceShapeId: shape.id,
          geometry: { points, provenance: 'manual' },
        } : null;
      }
      const radius = shape.rx ?? shape.r;
      if (![shape.x, shape.y, radius].every(Number.isFinite)) return null;
      return {
        type: 'highlight',
        coordMode: 'image',
        sourceShapeId: shape.id,
        geometry: { cx: shape.x, cy: shape.y, radius: radius!, provenance: 'manual' },
      };
    }
  }
}

export function importPinDocumentToClip(
  document: Annotations,
  atFrame: VideoFrame,
): PinImportResult {
  const matrix = perspectiveMatrix(document);
  const built: Array<BuiltShape & { style: ClipAnnotationStyle }> = [];
  let skipped = 0;

  for (const shape of document.shapes) {
    if ((shape as ExportShape & { _temp?: boolean })._temp || shape.id.startsWith('_temp_')) continue;
    const converted = buildShape(shape, matrix);
    if (!converted) {
      skipped += 1;
      continue;
    }
    built.push({ ...converted, style: normalizeStyle(shape) });
  }

  const annotations: ClipAnnotation[] = built.map((shape) => ({
    id: makeId(),
    type: shape.type,
    coordMode: shape.coordMode,
    source: 'manual',
    text: shape.text,
    closed: shape.closed,
    vertexRefs: shape.vertexRefs,
    style: shape.style,
    keyframes: [{ frame: atFrame, ...shape.geometry } as ClipKeyframe],
  }));
  const importedBySourceId = new Map(built.map((shape, index) => [
    shape.sourceShapeId,
    { id: annotations[index].id, type: annotations[index].type },
  ]));

  return {
    annotations: annotations.map((annotation, index) => {
      const refs = built[index].vertexRefs;
      if (!refs?.length) return annotation;
      const remapped = refs.map((reference) => {
        if (!reference) return null;
        const imported = importedBySourceId.get(reference);
        return imported?.type === 'highlight' ? imported.id : null;
      });
      return { ...annotation, vertexRefs: remapped.some(Boolean) ? remapped : undefined };
    }),
    skipped,
  };
}

export function applyPinImportToClip(
  existingAnnotations: ClipAnnotation[],
  importedAnnotations: ClipAnnotation[],
  atFrame: VideoFrame,
): AppliedPinImportResult {
  return {
    annotations: [...existingAnnotations, ...importedAnnotations],
    existingAtFrameCount: existingAnnotations.filter((annotation) => (
      annotation.keyframes.some((keyframe) => keyframe.frame === atFrame)
    )).length,
    importedCount: importedAnnotations.length,
    resolution: 'append',
  };
}
