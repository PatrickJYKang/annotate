import { describe, expect, it } from 'vitest';

import {
  deleteOverlappingHomographyCache,
  findOverlappingCache,
  readHomographyCache,
  writeHomographyCache,
} from './homographyCache';
import { MockFileSystem } from './test/mockFileSystem';

describe('homography cache identity', () => {
  it('isolates equal time ranges belonging to different videos', async () => {
    const fileSystem = new MockFileSystem();
    const first = [{ tMs: 1000, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], method: 'first' }];
    const second = [{ tMs: 1000, matrix: [2, 0, 0, 0, 2, 0, 0, 0, 1], method: 'second' }];

    await writeHomographyCache(fileSystem.root, 'video-a', 1000, 2000, first);
    await writeHomographyCache(fileSystem.root, 'video-b', 1000, 2000, second);

    await expect(readHomographyCache(fileSystem.root, 'video-a', 1000, 2000)).resolves.toEqual(first);
    await expect(readHomographyCache(fileSystem.root, 'video-b', 1000, 2000)).resolves.toEqual(second);
    await expect(findOverlappingCache(fileSystem.root, 'video-a', 1000, 1500)).resolves.toEqual(first);
  });

  it('deletes cached ranges that overlap the requested clip range only', async () => {
    const fileSystem = new MockFileSystem();
    const frames = [{ tMs: 1000, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], method: 'test' }];

    await writeHomographyCache(fileSystem.root, 'video-a', 0, 2000, frames);
    await writeHomographyCache(fileSystem.root, 'video-a', 3000, 4000, frames);

    await expect(deleteOverlappingHomographyCache(fileSystem.root, 'video-a', 1000, 2500)).resolves.toBe(1);
    await expect(readHomographyCache(fileSystem.root, 'video-a', 0, 2000)).resolves.toBeNull();
    await expect(readHomographyCache(fileSystem.root, 'video-a', 3000, 4000)).resolves.toEqual(frames);
  });
});
