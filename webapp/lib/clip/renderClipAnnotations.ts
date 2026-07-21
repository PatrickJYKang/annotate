import { contrastStrokeForHex, dashFromStrokePattern, hexToRgba } from '../annotate/shapeRendering';
import { buildShadowSectorPoints } from '../annotate/tacticalGeometry';
import type { ClipAnnotationStyle, ClipAnnotationType, ClipAnnotation } from '../types/clip';
import {
  interpolateAnnotation,
  type InterpolatedArrow,
  type InterpolatedHighlight,
  type InterpolatedKeyframe,
  type InterpolatedLob,
  type InterpolatedPoly,
  type InterpolatedShadow,
} from './interpolation';
import type { FrameBoundary, VideoFrame } from './frameMath';
import { getProjectedPitchShapeBounds, projectPitchKeyframeToImageShape } from './pitchProjection';

export type TemporalClipAnnotation = Pick<
  ClipAnnotation,
  'id' | 'type' | 'coordMode' | 'style' | 'text' | 'closed' | 'vertexRefs' | 'trackingAnchorId'
> & {
  keyframes: unknown[];
  visibilityKeyframes?: unknown[];
};

export interface ClipTemporalAdapter<A extends TemporalClipAnnotation = TemporalClipAnnotation> {
  resolve(annotation: A, sample: number): InterpolatedKeyframe | null;
}

export type ClipHomographyLookup = (sample: number) => number[] | null;

export interface ClipRenderDefaults {
  color?: string;
  fillOpacity?: number;
  fontSize?: number;
  textHighlight?: boolean;
}

export interface ResolvedDrawableStyle {
  stroke: string;
  strokeWidth: number;
  fill: string;
  dash: number[];
  fontSize: number;
  fontFamily: string;
  textHighlight: boolean;
}

type DrawableBase = {
  id: string;
  style: ResolvedDrawableStyle;
  order: number;
};

export type ClipDrawable =
  | DrawableBase & { kind: 'box'; x: number; y: number; w: number; h: number }
  | DrawableBase & { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | DrawableBase & { kind: 'polygon'; points: [number, number][]; closed: boolean }
  | DrawableBase & { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number }
  | DrawableBase & {
      kind: 'lob';
      start: { x: number; y: number };
      control: { x: number; y: number };
      end: { x: number; y: number };
    }
  | DrawableBase & { kind: 'text'; x: number; y: number; text: string };

export interface ClipCanvasSize {
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
}

function isFillCapable(type: ClipAnnotationType, closed?: boolean): boolean {
  return type === 'box'
    || type === 'circle'
    || type === 'highlight'
    || type === 'shadow'
    || (type === 'poly' && closed !== false);
}

function defaultStrokeWidth(type: ClipAnnotationType): number {
  if (type === 'text') return 1;
  if (type === 'shadow') return 3;
  return 6;
}

export function resolveClipDrawableStyle(
  annotation: TemporalClipAnnotation,
  defaults: ClipRenderDefaults = {},
): ResolvedDrawableStyle {
  const style = annotation.style ?? {};
  const stroke = style.stroke || defaults.color || '#000000';
  const strokeWidth = style.strokeWidth ?? defaultStrokeWidth(annotation.type);
  const fallbackOpacity = annotation.type === 'shadow' ? 0.22 : defaults.fillOpacity ?? 0.3;
  const fill = isFillCapable(annotation.type, annotation.closed)
    ? hexToRgba(style.fill && style.fill !== 'transparent' ? style.fill : stroke, style.fillOpacity ?? fallbackOpacity)
    : style.fill && style.fill !== 'transparent'
      ? hexToRgba(style.fill, style.fillOpacity ?? defaults.fillOpacity ?? 0.3)
      : 'transparent';
  return {
    stroke,
    strokeWidth,
    fill,
    dash: dashFromStrokePattern(style.strokePattern, strokeWidth) ?? [],
    fontSize: style.fontSize || defaults.fontSize || 48,
    fontFamily: style.fontFamily || 'Inter, system-ui, sans-serif',
    textHighlight: style.textHighlight ?? defaults.textHighlight ?? false,
  };
}

export function frameTemporalAdapter(
  clipEndFrame: FrameBoundary,
): ClipTemporalAdapter<ClipAnnotation> {
  return {
    resolve(annotation, sample) {
      return interpolateAnnotation(annotation, sample as VideoFrame, clipEndFrame);
    },
  };
}

function pushOutFromEllipse(
  highlight: { x: number; y: number; rx: number; ry: number },
  toward: { x: number; y: number },
): { x: number; y: number } {
  const vx = toward.x - highlight.x;
  const vy = toward.y - highlight.y;
  const denominator = (vx * vx) / ((highlight.rx * highlight.rx) || 1e-6)
    + (vy * vy) / ((highlight.ry * highlight.ry) || 1e-6);
  if (denominator <= 1e-8) return { x: highlight.x, y: highlight.y };
  const scale = 1 / Math.sqrt(denominator);
  const length = Math.hypot(vx, vy) || 1e-6;
  return {
    x: highlight.x + vx * scale + vx / length,
    y: highlight.y + vy * scale + vy / length,
  };
}

function flatPointsToPairs(points: number[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    pairs.push([points[index], points[index + 1]]);
  }
  return pairs;
}

function projectedDrawable(
  annotation: TemporalClipAnnotation,
  props: InterpolatedKeyframe,
  homography: number[] | null,
  style: ResolvedDrawableStyle,
): ClipDrawable | null {
  if (annotation.coordMode !== 'pitch') return null;
  if (!homography) return null;
  const projected = projectPitchKeyframeToImageShape(props, homography);
  if (!projected) return null;
  if (projected.kind === 'polygon') {
    return {
      id: annotation.id,
      kind: 'polygon',
      points: flatPointsToPairs(projected.points),
      closed: true,
      style,
      order: annotation.type === 'highlight' ? 3 : 1,
    };
  }
  if (projected.kind === 'arrow') {
    return {
      id: annotation.id,
      kind: 'arrow',
      x1: projected.points[0],
      y1: projected.points[1],
      x2: projected.points[2],
      y2: projected.points[3],
      style,
      order: 2,
    };
  }
  if (projected.kind === 'lob') {
    return {
      id: annotation.id,
      kind: 'lob',
      start: { x: projected.points[0], y: projected.points[1] },
      control: { x: projected.points[2], y: projected.points[3] },
      end: { x: projected.points[4], y: projected.points[5] },
      style,
      order: 2,
    };
  }
  return {
    id: annotation.id,
    kind: 'text',
    x: projected.x,
    y: projected.y,
    text: annotation.text || '',
    style,
    order: 4,
  };
}

export function resolveClipDrawables<A extends TemporalClipAnnotation>(
  annotations: readonly A[],
  sample: number,
  temporalAdapter: ClipTemporalAdapter<A>,
  homographyLookup: ClipHomographyLookup = () => null,
  defaults: ClipRenderDefaults = {},
): ClipDrawable[] {
  const homography = homographyLookup(sample);
  const resolved = new Map<string, InterpolatedKeyframe>();
  for (const annotation of annotations) {
    const props = temporalAdapter.resolve(annotation, sample);
    if (props) resolved.set(annotation.id, props);
  }

  const annotationById = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const resolveHighlight = (id: string | null | undefined) => {
    if (!id) return null;
    const annotation = annotationById.get(id);
    const props = resolved.get(id);
    if (!annotation || annotation.type !== 'highlight' || props?.type !== 'highlight') return null;
    if (annotation.coordMode === 'pitch') {
      if (!homography) return null;
      const projected = projectPitchKeyframeToImageShape(props, homography);
      if (!projected) return null;
      const bounds = getProjectedPitchShapeBounds(projected, defaults.fontSize ?? 48);
      return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2, rx: bounds.w / 2, ry: bounds.h / 2 };
    }
    const highlight = props as InterpolatedHighlight;
    return { x: highlight.cx, y: highlight.cy, rx: highlight.radius, ry: highlight.radius * 0.35 };
  };

  const drawables: ClipDrawable[] = [];
  annotations.forEach((annotation, sourceIndex) => {
    const props = resolved.get(annotation.id);
    if (!props) return;
    const style = resolveClipDrawableStyle(annotation, defaults);
    const pitchDrawable = projectedDrawable(annotation, props, homography, style);
    if (annotation.coordMode === 'pitch') {
      if (pitchDrawable) drawables.push({ ...pitchDrawable, order: pitchDrawable.order + sourceIndex / 100_000 });
      return;
    }

    const refs = annotation.vertexRefs ?? [];
    const sourceOrder = sourceIndex / 100_000;
    switch (props.type) {
      case 'box':
        drawables.push({ id: annotation.id, kind: 'box', ...props, style, order: 1 + sourceOrder });
        break;
      case 'circle':
        drawables.push({ id: annotation.id, kind: 'ellipse', ...props, style, order: 1 + sourceOrder });
        break;
      case 'shadow': {
        const shadow = props as InterpolatedShadow;
        const anchor = refs[0] ? resolveHighlight(refs[0]) : null;
        if (refs[0] && !anchor) break;
        const points = flatPointsToPairs(buildShadowSectorPoints(
          anchor?.x ?? shadow.x,
          anchor?.y ?? shadow.y,
          shadow.r,
          shadow.rotation,
          shadow.spreadDeg,
        ));
        if (points.length >= 2) {
          drawables.push({ id: annotation.id, kind: 'polygon', points, closed: true, style, order: sourceOrder });
        }
        break;
      }
      case 'arrow': {
        const arrow = props as InterpolatedArrow;
        const start = refs[0] ? resolveHighlight(refs[0]) : null;
        const end = refs[1] ? resolveHighlight(refs[1]) : null;
        if ((refs[0] && !start) || (refs[1] && !end)) break;
        let first = { x: start?.x ?? arrow.x1, y: start?.y ?? arrow.y1 };
        let second = { x: end?.x ?? arrow.x2, y: end?.y ?? arrow.y2 };
        if (start) first = pushOutFromEllipse(start, second);
        if (end) second = pushOutFromEllipse(end, first);
        drawables.push({
          id: annotation.id,
          kind: 'arrow',
          x1: first.x,
          y1: first.y,
          x2: second.x,
          y2: second.y,
          style,
          order: 2 + sourceOrder,
        });
        break;
      }
      case 'lob': {
        const lob = props as InterpolatedLob;
        const start = refs[0] ? resolveHighlight(refs[0]) : null;
        const end = refs[1] ? resolveHighlight(refs[1]) : null;
        if ((refs[0] && !start) || (refs[1] && !end)) break;
        drawables.push({
          id: annotation.id,
          kind: 'lob',
          start: { x: start?.x ?? lob.x1, y: start?.y ?? lob.y1 },
          control: { x: lob.cx, y: lob.cy },
          end: { x: end?.x ?? lob.x2, y: end?.y ?? lob.y2 },
          style,
          order: 2 + sourceOrder,
        });
        break;
      }
      case 'text':
        drawables.push({
          id: annotation.id,
          kind: 'text',
          x: props.x,
          y: props.y,
          text: annotation.text || '',
          style,
          order: 4 + sourceOrder,
        });
        break;
      case 'highlight':
        drawables.push({
          id: annotation.id,
          kind: 'ellipse',
          cx: props.cx,
          cy: props.cy,
          rx: props.radius,
          ry: props.radius * 0.35,
          style,
          order: 3 + sourceOrder,
        });
        break;
      case 'poly': {
        const poly = props as InterpolatedPoly;
        const points = refs.length === poly.points.length
          ? poly.points.flatMap((point, index) => {
              if (!refs[index]) return [point];
              const highlight = resolveHighlight(refs[index]);
              return highlight ? [[highlight.x, highlight.y] as [number, number]] : [];
            })
          : poly.points;
        if (points.length >= 2) {
          drawables.push({
            id: annotation.id,
            kind: 'polygon',
            points,
            closed: annotation.closed !== false && points.length >= 3,
            style,
            order: 2 + sourceOrder,
          });
        }
        break;
      }
    }
  });
  return drawables.sort((left, right) => left.order - right.order);
}

function applyStyle(context: CanvasRenderingContext2D, style: ResolvedDrawableStyle): void {
  context.strokeStyle = style.stroke;
  context.fillStyle = style.fill;
  context.lineWidth = style.strokeWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.setLineDash(style.dash);
}

function fillAndStroke(context: CanvasRenderingContext2D, style: ResolvedDrawableStyle): void {
  if (style.fill !== 'transparent') context.fill();
  context.stroke();
}

export function paintClipDrawablesToCanvas(
  context: CanvasRenderingContext2D,
  drawables: readonly ClipDrawable[],
  size: ClipCanvasSize,
): void {
  const sourceWidth = size.sourceWidth ?? size.width;
  const sourceHeight = size.sourceHeight ?? size.height;
  context.save();
  context.scale(size.width / sourceWidth, size.height / sourceHeight);
  for (const drawable of drawables) {
    context.save();
    applyStyle(context, drawable.style);
    switch (drawable.kind) {
      case 'box':
        if (drawable.style.fill !== 'transparent') context.fillRect(drawable.x, drawable.y, drawable.w, drawable.h);
        context.strokeRect(drawable.x, drawable.y, drawable.w, drawable.h);
        break;
      case 'ellipse':
        context.beginPath();
        context.ellipse(drawable.cx, drawable.cy, drawable.rx, drawable.ry, 0, 0, Math.PI * 2);
        fillAndStroke(context, drawable.style);
        break;
      case 'polygon':
        if (drawable.points.length < 2) break;
        context.beginPath();
        context.moveTo(drawable.points[0][0], drawable.points[0][1]);
        drawable.points.slice(1).forEach(([x, y]) => context.lineTo(x, y));
        if (drawable.closed) context.closePath();
        fillAndStroke(context, drawable.style);
        break;
      case 'arrow': {
        context.beginPath();
        context.moveTo(drawable.x1, drawable.y1);
        context.lineTo(drawable.x2, drawable.y2);
        context.stroke();
        const angle = Math.atan2(drawable.y2 - drawable.y1, drawable.x2 - drawable.x1);
        const headLength = Math.max(10, drawable.style.strokeWidth * 2.2);
        context.beginPath();
        context.moveTo(drawable.x2, drawable.y2);
        context.lineTo(
          drawable.x2 - headLength * Math.cos(angle - 0.4),
          drawable.y2 - headLength * Math.sin(angle - 0.4),
        );
        context.lineTo(
          drawable.x2 - headLength * Math.cos(angle + 0.4),
          drawable.y2 - headLength * Math.sin(angle + 0.4),
        );
        context.closePath();
        context.fillStyle = drawable.style.stroke;
        context.fill();
        break;
      }
      case 'lob': {
        context.beginPath();
        context.moveTo(drawable.start.x, drawable.start.y);
        context.quadraticCurveTo(
          drawable.control.x,
          drawable.control.y,
          drawable.end.x,
          drawable.end.y,
        );
        context.stroke();
        const tx = drawable.end.x - drawable.control.x;
        const ty = drawable.end.y - drawable.control.y;
        const length = Math.hypot(tx, ty) || 1;
        const ux = tx / length;
        const uy = ty / length;
        const px = -uy;
        const py = ux;
        const headLength = Math.max(10, drawable.style.strokeWidth * 2.2);
        const headWidth = Math.max(8, drawable.style.strokeWidth * 1.6);
        const baseX = drawable.end.x - ux * headLength;
        const baseY = drawable.end.y - uy * headLength;
        context.beginPath();
        context.moveTo(drawable.end.x, drawable.end.y);
        context.lineTo(baseX + px * headWidth * 0.5, baseY + py * headWidth * 0.5);
        context.lineTo(baseX - px * headWidth * 0.5, baseY - py * headWidth * 0.5);
        context.closePath();
        context.fillStyle = drawable.style.stroke;
        context.fill();
        break;
      }
      case 'text':
        context.font = `${drawable.style.fontSize}px ${drawable.style.fontFamily}`;
        if (drawable.style.textHighlight) {
          context.strokeStyle = contrastStrokeForHex(drawable.style.stroke);
          context.lineWidth = Math.max(2, Math.round(drawable.style.fontSize * 0.18));
          context.strokeText(drawable.text, drawable.x, drawable.y + drawable.style.fontSize);
        }
        context.fillStyle = drawable.style.stroke;
        context.fillText(drawable.text, drawable.x, drawable.y + drawable.style.fontSize);
        break;
    }
    context.restore();
  }
  context.restore();
}

export function renderClipAnnotationsToCanvas<A extends TemporalClipAnnotation>(args: {
  canvas: HTMLCanvasElement;
  annotations: readonly A[];
  sample: number;
  temporalAdapter: ClipTemporalAdapter<A>;
  homographyLookup?: ClipHomographyLookup;
  defaults?: ClipRenderDefaults;
  size?: ClipCanvasSize;
}): ClipDrawable[] {
  const context = args.canvas.getContext('2d');
  if (!context) return [];
  const drawables = resolveClipDrawables(
    args.annotations,
    args.sample,
    args.temporalAdapter,
    args.homographyLookup,
    args.defaults,
  );
  paintClipDrawablesToCanvas(context, drawables, args.size ?? {
    width: args.canvas.width,
    height: args.canvas.height,
  });
  return drawables;
}
