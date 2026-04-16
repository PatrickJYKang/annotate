export const DEFAULT_SHADOW_RADIUS = 140;
export const DEFAULT_SHADOW_SPREAD_DEG = 42;

export function degreesToRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radiansToDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function buildDefaultLobControlPoint(
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy) || 1;
  let nx = -dy / dist;
  let ny = dx / dist;
  if (ny > 0) {
    nx *= -1;
    ny *= -1;
  }
  const lift = Math.max(36, Math.min(120, dist * 0.35));
  return {
    x: (start.x + end.x) / 2 + nx * lift,
    y: (start.y + end.y) / 2 + ny * lift,
  };
}

export function buildShadowSectorPoints(
  centerX: number,
  centerY: number,
  radius: number,
  rotationDeg: number,
  spreadDeg: number,
  segments = 24,
): number[] {
  const clampedRadius = Math.max(1, radius);
  const clampedSpread = Math.max(1, Math.min(359, spreadDeg));
  const start = degreesToRadians(rotationDeg - clampedSpread / 2);
  const end = degreesToRadians(rotationDeg + clampedSpread / 2);
  const points: number[] = [centerX, centerY];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const angle = start + (end - start) * t;
    points.push(centerX + Math.cos(angle) * clampedRadius, centerY + Math.sin(angle) * clampedRadius);
  }
  return points;
}

export function getBoundsForFlatPoints(points: number[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxX = Math.max(maxX, points[i]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  return {
    x: minX,
    y: minY,
    w: Math.max(0, maxX - minX),
    h: Math.max(0, maxY - minY),
  };
}
