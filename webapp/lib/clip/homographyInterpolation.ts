import {
  applyHomography,
  computeHomographyFromCorrespondences,
} from '../annotate/homography';
import type { HomographyFrame } from '../fs/homographyCache';

const PITCH_CONTROL_POINTS: { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 52.5, y: 0 },
  { x: 105, y: 0 },
  { x: 0, y: 34 },
  { x: 52.5, y: 34 },
  { x: 105, y: 34 },
  { x: 0, y: 68 },
  { x: 52.5, y: 68 },
  { x: 105, y: 68 },
  { x: 11, y: 34 },
  { x: 94, y: 34 },
];

export function isUsableHomographyFrame(frame: HomographyFrame): boolean {
  return (
    frame.method !== 'failed'
    && Array.isArray(frame.matrix)
    && frame.matrix.length === 9
    && frame.matrix.every(Number.isFinite)
  );
}

function determinant3(m: number[]): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7])
    - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

export function normalizeHomography(m: number[]): number[] | null {
  if (m.length !== 9 || !m.every(Number.isFinite)) return null;
  const scale = Math.abs(m[8]) > 1e-9 ? m[8] : 1;
  const normalized = m.map((value) => value / scale);
  if (!normalized.every(Number.isFinite)) return null;
  if (Math.abs(determinant3(normalized)) < 1e-9) return null;
  return normalized;
}

type ProjectedPoint = { x: number; y: number };

type HomographyAnalysis = {
  frame: HomographyFrame;
  matrix: number[];
  projected: ProjectedPoint[];
  span: number;
  robustSpan: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function polygonArea(points: ProjectedPoint[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]!;
    const next = points[(i + 1) % points.length]!;
    area += (current.x * next.y) - (next.x * current.y);
  }
  return Math.abs(area) / 2;
}

function analyzeHomographyFrame(frame: HomographyFrame): HomographyAnalysis | null {
  const matrix = normalizeHomography(frame.matrix);
  if (!matrix) return null;
  const projected = PITCH_CONTROL_POINTS.map((point) => applyHomography(matrix, point.x, point.y));
  if (projected.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;

  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const span = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
  if (!Number.isFinite(span) || span < 10) return null;
  const sortedXs = [...xs].sort((a, b) => a - b);
  const sortedYs = [...ys].sort((a, b) => a - b);
  const robustSpan = Math.max(
    sortedXs[sortedXs.length - 2]! - sortedXs[1]!,
    sortedYs[sortedYs.length - 2]! - sortedYs[1]!,
  );
  if (!Number.isFinite(robustSpan) || robustSpan < 10) return null;

  const cornerArea = polygonArea([
    projected[0]!,
    projected[2]!,
    projected[8]!,
    projected[6]!,
  ]);
  if (!Number.isFinite(cornerArea) || cornerArea < 1_000) return null;

  return { frame, matrix, projected, span, robustSpan };
}

function homographyDistance(
  left: HomographyAnalysis,
  right: HomographyAnalysis,
): { mean: number; max: number; median: number } {
  let total = 0;
  let max = 0;
  const distances: number[] = [];
  for (let index = 0; index < left.projected.length; index += 1) {
    const a = left.projected[index]!;
    const b = right.projected[index]!;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    distances.push(distance);
    total += distance;
    if (distance > max) max = distance;
  }
  return {
    mean: total / left.projected.length,
    max,
    median: median(distances),
  };
}

function isInterpolationPairStable(
  left: HomographyAnalysis,
  right: HomographyAnalysis,
): boolean {
  const distance = homographyDistance(left, right);
  const referenceSpan = Math.max(left.span, right.span);
  const maxAllowedMean = Math.max(120, referenceSpan * 0.18);
  const maxAllowedPeak = Math.max(220, referenceSpan * 0.32);
  return distance.mean <= maxAllowedMean && distance.max <= maxAllowedPeak;
}

function pruneOutlierFrames(analyses: HomographyAnalysis[]): HomographyAnalysis[] {
  if (analyses.length < 3) return analyses;
  return analyses.filter((analysis, index) => {
    if (index === 0 || index === analyses.length - 1) return true;
    const previous = analyses[index - 1]!;
    const next = analyses[index + 1]!;
    const prevNext = homographyDistance(previous, next);
    const prevCurrent = homographyDistance(previous, analysis);
    const currentNext = homographyDistance(analysis, next);

    const temporalThreshold = Math.max(prevNext.median * 2.5, 500);
    const isTemporalOutlier =
      prevCurrent.median > temporalThreshold
      && currentNext.median > temporalThreshold;

    const smallerNeighborSpan = Math.min(previous.robustSpan, next.robustSpan);
    const largerNeighborSpan = Math.max(previous.robustSpan, next.robustSpan);
    const neighborsHaveComparableScale = largerNeighborSpan <= smallerNeighborSpan * 4;
    const isCollapsedProjection =
      neighborsHaveComparableScale
      && analysis.robustSpan < smallerNeighborSpan * 0.15;

    return !isTemporalOutlier && !isCollapsedProjection;
  });
}

function selectAnchorFrames(frames: HomographyFrame[]): HomographyFrame[] {
  const usable = frames.filter(isUsableHomographyFrame);
  const directPnlCalibFrames = usable.filter((frame) => frame.method === 'pnlcalib');

  // PnLCalib's derived gap frames can inherit a corrupt solve. Rebuild those
  // gaps from sanitized direct anchors instead of treating derived data as new evidence.
  return directPnlCalibFrames.length >= 2 ? directPnlCalibFrames : usable;
}

function interpolateBetweenFrames(
  previousFrame: HomographyAnalysis,
  nextFrame: HomographyAnalysis,
  targetMs: number,
): number[] | null {
  const totalGap = nextFrame.frame.tMs - previousFrame.frame.tMs;
  if (totalGap <= 1e-6) return previousFrame.matrix;

  const alpha = (targetMs - previousFrame.frame.tMs) / totalGap;
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const interpolatedImagePoints = PITCH_CONTROL_POINTS.map((point) => {
    const previousProjected = applyHomography(previousFrame.matrix, point.x, point.y);
    const nextProjected = applyHomography(nextFrame.matrix, point.x, point.y);
    return {
      x: ((1 - clampedAlpha) * previousProjected.x) + (clampedAlpha * nextProjected.x),
      y: ((1 - clampedAlpha) * previousProjected.y) + (clampedAlpha * nextProjected.y),
    };
  });

  const solved = computeHomographyFromCorrespondences(PITCH_CONTROL_POINTS, interpolatedImagePoints);
  return solved ? normalizeHomography(solved) : null;
}

export function resolveUsableHomographyAtTime(
  frames: HomographyFrame[] | null | undefined,
  absMs: number,
): number[] | null {
  if (!frames || frames.length === 0) return null;
  const usable = pruneOutlierFrames(
    selectAnchorFrames(frames)
      .sort((a, b) => a.tMs - b.tMs)
      .map(analyzeHomographyFrame)
      .filter((analysis): analysis is HomographyAnalysis => analysis !== null),
  );
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0].matrix;

  if (absMs <= usable[0].frame.tMs) return usable[0].matrix;
  if (absMs >= usable[usable.length - 1]!.frame.tMs) {
    const last = usable[usable.length - 1]!;
    return last.matrix;
  }

  for (let index = 0; index < usable.length - 1; index += 1) {
    const previous = usable[index]!;
    const next = usable[index + 1]!;
    if (absMs < previous.frame.tMs || absMs > next.frame.tMs) continue;
    if (Math.abs(absMs - previous.frame.tMs) < 1e-6) return previous.matrix;
    if (Math.abs(absMs - next.frame.tMs) < 1e-6) return next.matrix;
    if (!isInterpolationPairStable(previous, next)) {
      return Math.abs(absMs - previous.frame.tMs) <= Math.abs(next.frame.tMs - absMs)
        ? previous.matrix
        : next.matrix;
    }
    return (
      interpolateBetweenFrames(previous, next, absMs)
      || previous.matrix
      || next.matrix
    );
  }

  const nearest = usable.reduce((best, frame) => (
    Math.abs(frame.frame.tMs - absMs) < Math.abs(best.frame.tMs - absMs) ? frame : best
  ));
  return nearest.matrix;
}
