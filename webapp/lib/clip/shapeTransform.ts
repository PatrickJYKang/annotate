import type { ClipAnnotationType } from '../types/clip';

export type TransformPoint = { x: number; y: number };

export type ShapeTransformHandleId =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'rotate';

export type OrientedClipShape = {
  type: 'box' | 'circle';
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
};

export type ShapeTransformHandle = {
  id: ShapeTransformHandleId;
  x: number;
  y: number;
  cursor: string;
};

export type ShapeTransformOverlay = {
  outline: TransformPoint[];
  resizeHandles: ShapeTransformHandle[];
  rotationStem: [TransformPoint, TransformPoint];
  rotationHandle: ShapeTransformHandle;
};

const HANDLE_LAYOUT: Array<{
  id: Exclude<ShapeTransformHandleId, 'rotate'>;
  sx: -1 | 0 | 1;
  sy: -1 | 0 | 1;
  cursor: string;
}> = [
  { id: 'nw', sx: -1, sy: -1, cursor: 'nwse-resize' },
  { id: 'n', sx: 0, sy: -1, cursor: 'ns-resize' },
  { id: 'ne', sx: 1, sy: -1, cursor: 'nesw-resize' },
  { id: 'e', sx: 1, sy: 0, cursor: 'ew-resize' },
  { id: 'se', sx: 1, sy: 1, cursor: 'nwse-resize' },
  { id: 's', sx: 0, sy: 1, cursor: 'ns-resize' },
  { id: 'sw', sx: -1, sy: 1, cursor: 'nesw-resize' },
  { id: 'w', sx: -1, sy: 0, cursor: 'ew-resize' },
];

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function normalizeAngleNear(value: number, reference: number): number {
  let normalized = value;
  while (normalized - reference > 180) normalized -= 360;
  while (normalized - reference < -180) normalized += 360;
  return normalized;
}

function localAxes(rotation: number): {
  xAxis: TransformPoint;
  yAxis: TransformPoint;
} {
  const radians = degreesToRadians(rotation);
  return {
    xAxis: { x: Math.cos(radians), y: Math.sin(radians) },
    yAxis: { x: -Math.sin(radians), y: Math.cos(radians) },
  };
}

function pointAt(
  shape: OrientedClipShape,
  sx: number,
  sy: number,
): TransformPoint {
  const { xAxis, yAxis } = localAxes(shape.rotation);
  return {
    x: shape.cx + xAxis.x * shape.width * sx / 2 + yAxis.x * shape.height * sy / 2,
    y: shape.cy + xAxis.y * shape.width * sx / 2 + yAxis.y * shape.height * sy / 2,
  };
}

export function orientedClipShapeFromGeometry(
  type: ClipAnnotationType,
  geometry: Record<string, unknown>,
): OrientedClipShape | null {
  const rotation = finiteNumber(geometry.rotation);
  if (type === 'box') {
    const width = Math.max(0, finiteNumber(geometry.w));
    const height = Math.max(0, finiteNumber(geometry.h));
    const x = finiteNumber(geometry.x);
    const y = finiteNumber(geometry.y);
    return {
      type,
      cx: x + width / 2,
      cy: y + height / 2,
      width,
      height,
      rotation,
    };
  }
  if (type === 'circle') {
    return {
      type,
      cx: finiteNumber(geometry.cx),
      cy: finiteNumber(geometry.cy),
      width: Math.max(0, finiteNumber(geometry.rx) * 2),
      height: Math.max(0, finiteNumber(geometry.ry) * 2),
      rotation,
    };
  }
  return null;
}

export function clipGeometryFromOrientedShape(
  shape: OrientedClipShape,
): Record<string, number> {
  if (shape.type === 'box') {
    return {
      x: shape.cx - shape.width / 2,
      y: shape.cy - shape.height / 2,
      w: shape.width,
      h: shape.height,
      rotation: shape.rotation,
    };
  }
  return {
    cx: shape.cx,
    cy: shape.cy,
    rx: shape.width / 2,
    ry: shape.height / 2,
    rotation: shape.rotation,
  };
}

export function rotationPointerOffset(
  shape: OrientedClipShape,
  pointer: TransformPoint,
): number {
  const pointerRotation = Math.atan2(pointer.y - shape.cy, pointer.x - shape.cx) * 180 / Math.PI + 90;
  return normalizeAngleNear(shape.rotation - pointerRotation, 0);
}

export function transformOrientedClipShape(
  shape: OrientedClipShape,
  handleId: ShapeTransformHandleId,
  pointer: TransformPoint,
  options: {
    minWidth?: number;
    minHeight?: number;
    rotationOffset?: number;
  } = {},
): OrientedClipShape {
  if (handleId === 'rotate') {
    const pointerRotation = Math.atan2(pointer.y - shape.cy, pointer.x - shape.cx) * 180 / Math.PI + 90;
    return {
      ...shape,
      rotation: normalizeAngleNear(
        pointerRotation + (options.rotationOffset ?? 0),
        shape.rotation,
      ),
    };
  }

  const handle = HANDLE_LAYOUT.find((candidate) => candidate.id === handleId);
  if (!handle) return shape;
  const { xAxis, yAxis } = localAxes(shape.rotation);
  const dx = pointer.x - shape.cx;
  const dy = pointer.y - shape.cy;
  const pointerX = dx * xAxis.x + dy * xAxis.y;
  const pointerY = dx * yAxis.x + dy * yAxis.y;
  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  const minHalfWidth = Math.max(0.0001, options.minWidth ?? 0.5) / 2;
  const minHalfHeight = Math.max(0.0001, options.minHeight ?? 0.5) / 2;

  const nextHalfWidth = handle.sx === 0
    ? halfWidth
    : Math.max(minHalfWidth, (pointerX * handle.sx + halfWidth) / 2);
  const nextHalfHeight = handle.sy === 0
    ? halfHeight
    : Math.max(minHalfHeight, (pointerY * handle.sy + halfHeight) / 2);
  const centerShiftX = handle.sx === 0 ? 0 : handle.sx * (nextHalfWidth - halfWidth);
  const centerShiftY = handle.sy === 0 ? 0 : handle.sy * (nextHalfHeight - halfHeight);

  return {
    ...shape,
    cx: shape.cx + xAxis.x * centerShiftX + yAxis.x * centerShiftY,
    cy: shape.cy + xAxis.y * centerShiftX + yAxis.y * centerShiftY,
    width: nextHalfWidth * 2,
    height: nextHalfHeight * 2,
  };
}

export function buildShapeTransformOverlay(
  shape: OrientedClipShape,
  project: (point: TransformPoint) => TransformPoint | null,
  rotationHandleGap: number,
): ShapeTransformOverlay | null {
  const outlineNative = shape.type === 'box'
    ? [
        pointAt(shape, -1, -1),
        pointAt(shape, 1, -1),
        pointAt(shape, 1, 1),
        pointAt(shape, -1, 1),
      ]
    : Array.from({ length: 48 }, (_, index) => {
        const angle = index / 48 * Math.PI * 2;
        return pointAt(shape, Math.cos(angle), Math.sin(angle));
      });
  const outline = outlineNative.map(project);
  if (outline.some((point) => !point)) return null;

  const resizeHandles = HANDLE_LAYOUT.flatMap((handle) => {
    const point = project(pointAt(shape, handle.sx, handle.sy));
    return point ? [{ id: handle.id, ...point, cursor: handle.cursor }] : [];
  });
  if (resizeHandles.length !== HANDLE_LAYOUT.length) return null;

  const center = project({ x: shape.cx, y: shape.cy });
  const top = project(pointAt(shape, 0, -1));
  if (!center || !top) return null;
  const dx = top.x - center.x;
  const dy = top.y - center.y;
  const length = Math.hypot(dx, dy);
  const ux = length > 1e-6 ? dx / length : 0;
  const uy = length > 1e-6 ? dy / length : -1;
  const rotationPoint = {
    x: top.x + ux * rotationHandleGap,
    y: top.y + uy * rotationHandleGap,
  };

  return {
    outline: outline as TransformPoint[],
    resizeHandles,
    rotationStem: [top, rotationPoint],
    rotationHandle: {
      id: 'rotate',
      ...rotationPoint,
      cursor: 'grab',
    },
  };
}

export function hitShapeTransformHandle(
  overlay: ShapeTransformOverlay,
  point: TransformPoint,
  radius: number,
): ShapeTransformHandle | null {
  const handles = [...overlay.resizeHandles, overlay.rotationHandle];
  let nearest: ShapeTransformHandle | null = null;
  let nearestDistance = Infinity;
  for (const handle of handles) {
    const distance = Math.hypot(point.x - handle.x, point.y - handle.y);
    if (distance <= radius && distance < nearestDistance) {
      nearest = handle;
      nearestDistance = distance;
    }
  }
  return nearest;
}
