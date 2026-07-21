import { applyHomography } from './homography';

export type HomographyGridLine = Array<{ x: number; y: number }>;

export interface HomographyGridBounds {
  width: number;
  height: number;
  columns?: number;
  rows?: number;
}

export function buildHomographyGrid(
  matrix: number[] | null | undefined,
  {
    width,
    height,
    columns = 7,
    rows = 5,
  }: HomographyGridBounds,
): HomographyGridLine[] {
  if (!matrix || matrix.length !== 9 || !matrix.every(Number.isFinite)) return [];
  if (!(width > 0) || !(height > 0) || columns < 1 || rows < 1) return [];

  const project = (x: number, y: number) => applyHomography(matrix, x, y);
  const lines: HomographyGridLine[] = [];

  for (let column = 0; column <= columns; column += 1) {
    const x = width * (column / columns);
    const line = Array.from({ length: rows + 1 }, (_, row) => project(x, height * (row / rows)));
    if (line.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) lines.push(line);
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = height * (row / rows);
    const line = Array.from({ length: columns + 1 }, (_, column) => project(width * (column / columns), y));
    if (line.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) lines.push(line);
  }

  return lines;
}
