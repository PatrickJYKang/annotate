import { describe, expect, it } from 'vitest';

import { projectPitchBoundsToPerspectiveQuad } from './pitchCalibration';

describe('projectPitchBoundsToPerspectiveQuad', () => {
  it('projects pitch corners through the supplied homography', () => {
    const matrix = [
      2, 0, 10,
      0, 3, 20,
      0, 0, 1,
    ];

    expect(projectPitchBoundsToPerspectiveQuad(matrix)).toEqual([
      { x: 10, y: 20 },
      { x: 220, y: 20 },
      { x: 220, y: 224 },
      { x: 10, y: 224 },
    ]);
  });

  it('rejects invalid matrices', () => {
    expect(projectPitchBoundsToPerspectiveQuad(null)).toBeNull();
    expect(projectPitchBoundsToPerspectiveQuad([1, 2, 3])).toBeNull();
  });
});
