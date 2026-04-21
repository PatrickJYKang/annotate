import {
  applyHomography,
  applyHomographyInv,
  ellipsePlaneToImagePoints,
  rectPlaneToImagePoints,
} from '../annotate/homography';
import { getBoundsForFlatPoints } from '../annotate/tacticalGeometry';
import type { ClipAnnotationType } from '../types/clip';
import type {
  InterpolatedArrow,
  InterpolatedBox,
  InterpolatedCircle,
  InterpolatedHighlight,
  InterpolatedKeyframe,
  InterpolatedLob,
  InterpolatedPoly,
  InterpolatedText,
} from './interpolation';

export type PitchProjectedShape =
  | { kind: 'polygon'; points: number[] }
  | { kind: 'arrow'; points: number[] }
  | { kind: 'lob'; points: number[] }
  | { kind: 'text'; x: number; y: number };

export function annotationTypeSupportsPitchCoords(type: ClipAnnotationType): boolean {
  return type === 'box' || type === 'circle';
}

export function projectImagePointToPitchPoint(
  homographyInverse: number[] | null,
  x: number,
  y: number,
): { u: number; v: number } {
  if (!homographyInverse) return { u: x, v: y };
  return applyHomographyInv(homographyInverse, x, y);
}

export function convertImageGeometryToPitchGeometry(
  type: ClipAnnotationType,
  geometry: Record<string, any>,
  homographyInverse: number[] | null,
): Record<string, any> {
  if (!homographyInverse || !annotationTypeSupportsPitchCoords(type)) return geometry;

  const toPitchPoint = (x: number, y: number) => projectImagePointToPitchPoint(homographyInverse, x, y);

  switch (type) {
    case 'box': {
      const x = Number(geometry.x ?? 0);
      const y = Number(geometry.y ?? 0);
      const w = Number(geometry.w ?? 0);
      const h = Number(geometry.h ?? 0);
      const corners = [
        toPitchPoint(x, y),
        toPitchPoint(x + w, y),
        toPitchPoint(x + w, y + h),
        toPitchPoint(x, y + h),
      ];
      const us = corners.map((point) => point.u);
      const vs = corners.map((point) => point.v);
      return {
        x: Math.min(...us),
        y: Math.min(...vs),
        w: Math.max(...us) - Math.min(...us),
        h: Math.max(...vs) - Math.min(...vs),
      };
    }
    case 'circle': {
      const cx = Number(geometry.cx ?? 0);
      const cy = Number(geometry.cy ?? 0);
      const rx = Number(geometry.rx ?? 0);
      const ry = Number(geometry.ry ?? 0);
      const center = toPitchPoint(cx, cy);
      const px = toPitchPoint(cx + rx, cy);
      const py = toPitchPoint(cx, cy + ry);
      return {
        cx: center.u,
        cy: center.v,
        rx: Math.hypot(px.u - center.u, px.v - center.v),
        ry: Math.hypot(py.u - center.u, py.v - center.v),
      };
    }
    case 'highlight': {
      const cx = Number(geometry.cx ?? 0);
      const cy = Number(geometry.cy ?? 0);
      const radius = Number(geometry.radius ?? 0);
      const center = toPitchPoint(cx, cy);
      const edge = toPitchPoint(cx + radius, cy);
      return {
        cx: center.u,
        cy: center.v,
        radius: Math.hypot(edge.u - center.u, edge.v - center.v),
      };
    }
    case 'arrow':
      return {
        x1: toPitchPoint(Number(geometry.x1 ?? 0), Number(geometry.y1 ?? 0)).u,
        y1: toPitchPoint(Number(geometry.x1 ?? 0), Number(geometry.y1 ?? 0)).v,
        x2: toPitchPoint(Number(geometry.x2 ?? 0), Number(geometry.y2 ?? 0)).u,
        y2: toPitchPoint(Number(geometry.x2 ?? 0), Number(geometry.y2 ?? 0)).v,
      };
    case 'lob': {
      const start = toPitchPoint(Number(geometry.x1 ?? 0), Number(geometry.y1 ?? 0));
      const control = toPitchPoint(Number(geometry.cx ?? 0), Number(geometry.cy ?? 0));
      const end = toPitchPoint(Number(geometry.x2 ?? 0), Number(geometry.y2 ?? 0));
      return {
        x1: start.u,
        y1: start.v,
        cx: control.u,
        cy: control.v,
        x2: end.u,
        y2: end.v,
      };
    }
    case 'text': {
      const point = toPitchPoint(Number(geometry.x ?? 0), Number(geometry.y ?? 0));
      return { x: point.u, y: point.v };
    }
    case 'poly': {
      const points = Array.isArray(geometry.points) ? geometry.points as Array<[number, number]> : [];
      return {
        points: points.map(([x, y]) => {
          const point = toPitchPoint(Number(x ?? 0), Number(y ?? 0));
          return [point.u, point.v] as [number, number];
        }),
      };
    }
    default:
      return geometry;
  }
}

export function projectPitchKeyframeToImageShape(
  props: InterpolatedKeyframe,
  homography: number[],
): PitchProjectedShape | null {
  switch (props.type) {
    case 'box': {
      const box = props as InterpolatedBox;
      return {
        kind: 'polygon',
        points: rectPlaneToImagePoints(homography, box.x + box.w / 2, box.y + box.h / 2, box.w, box.h),
      };
    }
    case 'circle': {
      const circle = props as InterpolatedCircle;
      return {
        kind: 'polygon',
        points: ellipsePlaneToImagePoints(homography, circle.cx, circle.cy, circle.rx, circle.ry),
      };
    }
    case 'highlight': {
      const highlight = props as InterpolatedHighlight;
      return {
        kind: 'polygon',
        points: ellipsePlaneToImagePoints(
          homography,
          highlight.cx,
          highlight.cy,
          highlight.radius,
          highlight.radius * 0.35,
        ),
      };
    }
    case 'arrow': {
      const arrow = props as InterpolatedArrow;
      const start = applyHomography(homography, arrow.x1, arrow.y1);
      const end = applyHomography(homography, arrow.x2, arrow.y2);
      return {
        kind: 'arrow',
        points: [start.x, start.y, end.x, end.y],
      };
    }
    case 'lob': {
      const lob = props as InterpolatedLob;
      const start = applyHomography(homography, lob.x1, lob.y1);
      const control = applyHomography(homography, lob.cx, lob.cy);
      const end = applyHomography(homography, lob.x2, lob.y2);
      return {
        kind: 'lob',
        points: [start.x, start.y, control.x, control.y, end.x, end.y],
      };
    }
    case 'text': {
      const text = props as InterpolatedText;
      const point = applyHomography(homography, text.x, text.y);
      return {
        kind: 'text',
        x: point.x,
        y: point.y,
      };
    }
    case 'poly': {
      const poly = props as InterpolatedPoly;
      return {
        kind: 'polygon',
        points: poly.points.flatMap(([x, y]) => {
          const point = applyHomography(homography, x, y);
          return [point.x, point.y];
        }),
      };
    }
    default:
      return null;
  }
}

export function getProjectedPitchShapeBounds(
  projected: PitchProjectedShape,
  fontSize: number,
): { x: number; y: number; w: number; h: number } {
  if (projected.kind === 'text') {
    return { x: projected.x, y: projected.y, w: 100, h: fontSize };
  }
  return getBoundsForFlatPoints(projected.points);
}
