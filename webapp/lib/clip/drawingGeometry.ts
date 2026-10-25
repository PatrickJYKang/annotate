type Point = { x: number; y: number };

export function boxOrCircleGeometryFromDrag(
  type: 'box' | 'circle',
  start: Point,
  end: Point,
  phase: 'preview' | 'commit',
): Record<string, number> | null {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  // Click-to-place dimensions belong to mouse-up, never the live drag preview.
  if (phase === 'commit' && width < 4 && height < 4) {
    return type === 'box'
      ? { x: start.x - 60, y: start.y - 40, w: 120, h: 80 }
      : { cx: start.x, cy: start.y, rx: 50, ry: 30 };
  }
  if (phase === 'preview' && width === 0 && height === 0) return null;
  return type === 'box'
    ? { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: width, h: height }
    : { cx: (start.x + end.x) / 2, cy: (start.y + end.y) / 2, rx: width / 2, ry: height / 2 };
}
