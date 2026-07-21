import { describe, expect, it } from 'vitest';

import { buildHomographyGrid } from './homographyOverlay';

describe('buildHomographyGrid', () => {
  it('projects both axes over the requested plane bounds', () => {
    const lines = buildHomographyGrid(
      [2, 0, 10, 0, 3, 20, 0, 0, 1],
      { width: 4, height: 2, columns: 2, rows: 1 },
    );

    expect(lines).toHaveLength(5);
    expect(lines[0]).toEqual([{ x: 10, y: 20 }, { x: 10, y: 26 }]);
    expect(lines.at(-1)).toEqual([
      { x: 10, y: 26 },
      { x: 14, y: 26 },
      { x: 18, y: 26 },
    ]);
  });

  it('rejects malformed matrices', () => {
    expect(buildHomographyGrid([1, 2], { width: 1, height: 1 })).toEqual([]);
  });
});
