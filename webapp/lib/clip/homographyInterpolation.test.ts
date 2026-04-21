import { describe, expect, it } from 'vitest';

import type { HomographyFrame } from '../fs/homographyCache';
import { resolveUsableHomographyAtTime } from './homographyInterpolation';

function translationFrame(tMs: number, tx: number, ty: number, method = 'pnlcalib'): HomographyFrame {
  return {
    tMs,
    method,
    matrix: [1, 0, tx, 0, 1, ty, 0, 0, 1],
  };
}

describe('resolveUsableHomographyAtTime', () => {
  it('returns the exact matrix at a sampled timestamp', () => {
    const frames = [
      translationFrame(1000, 10, 20),
      translationFrame(1200, 30, 40),
    ];

    expect(resolveUsableHomographyAtTime(frames, 1200)).toEqual(frames[1]?.matrix);
  });

  it('interpolates smoothly between neighboring usable frames', () => {
    const frames = [
      translationFrame(1000, 10, 20),
      translationFrame(1200, 30, 40),
    ];

    const matrix = resolveUsableHomographyAtTime(frames, 1100);

    expect(matrix).not.toBeNull();
    expect(matrix?.[2]).toBeCloseTo(20, 4);
    expect(matrix?.[5]).toBeCloseTo(30, 4);
  });

  it('ignores failed frames when finding usable neighbors', () => {
    const frames = [
      translationFrame(1000, 10, 20),
      translationFrame(1100, 0, 0, 'failed'),
      translationFrame(1200, 30, 40),
    ];

    const matrix = resolveUsableHomographyAtTime(frames, 1100);

    expect(matrix).not.toBeNull();
    expect(matrix?.[2]).toBeCloseTo(20, 4);
    expect(matrix?.[5]).toBeCloseTo(30, 4);
  });

  it('falls back to the closest usable edge frame outside the sampled range', () => {
    const frames = [
      translationFrame(1000, 10, 20),
      translationFrame(1200, 30, 40),
    ];

    expect(resolveUsableHomographyAtTime(frames, 900)).toEqual(frames[0]?.matrix);
    expect(resolveUsableHomographyAtTime(frames, 1300)).toEqual(frames[1]?.matrix);
  });

  it('does not interpolate across wildly incompatible neighboring frames', () => {
    const frames = [
      translationFrame(1000, 10, 20),
      translationFrame(1200, 1200, 900),
    ];

    expect(resolveUsableHomographyAtTime(frames, 1100)).toEqual(frames[0]?.matrix);
  });

  it('drops an isolated outlier frame between two similar neighbors', () => {
    const frames = [
      translationFrame(1000, 10, 20),
      translationFrame(1100, 1400, 1100),
      translationFrame(1200, 12, 22),
    ];

    const matrix = resolveUsableHomographyAtTime(frames, 1100);

    expect(matrix).not.toBeNull();
    expect(matrix?.[2]).toBeCloseTo(11, 4);
    expect(matrix?.[5]).toBeCloseTo(21, 4);
  });
});
