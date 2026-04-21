import { applyHomography } from './homography';

export const PITCH_LENGTH_M = 105;
export const PITCH_WIDTH_M = 68;

export type PerspectiveQuadPoint = { x: number; y: number };

export function projectPitchBoundsToPerspectiveQuad(
  matrix: number[] | null | undefined,
): PerspectiveQuadPoint[] | null {
  if (!Array.isArray(matrix) || matrix.length !== 9 || !matrix.every(Number.isFinite)) return null;

  const corners = [
    { x: 0, y: 0 },
    { x: PITCH_LENGTH_M, y: 0 },
    { x: PITCH_LENGTH_M, y: PITCH_WIDTH_M },
    { x: 0, y: PITCH_WIDTH_M },
  ];

  const quad = corners.map((point) => applyHomography(matrix, point.x, point.y));
  if (quad.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  return quad;
}
