import { describe, expect, it } from 'vitest';

import { videoFrame } from '../clip/frameMath';
import {
  createSerializedFrameRasterQueue,
  frameRasterCachePath,
} from './frameRaster';

describe('frameRaster', () => {
  it('uses output width in cache identity so thumbnails cannot satisfy exports', () => {
    expect(frameRasterCachePath('video_main', videoFrame(42), 320)).toBe(
      'cache/frames/video_main/42@320.png',
    );
    expect(frameRasterCachePath('video_main', videoFrame(42), 1920)).not.toBe(
      frameRasterCachePath('video_main', videoFrame(42), 320),
    );
  });

  it('serializes concurrent frame requests in request order', async () => {
    const events: string[] = [];
    const releases: (() => void)[] = [];
    const queue = createSerializedFrameRasterQueue(async (request) => {
      events.push(`start:${request.frame}`);
      await new Promise<void>((resolve) => releases.push(resolve));
      events.push(`finish:${request.frame}`);
      return { blob: new Blob([String(request.frame)]), width: 100, height: 50 };
    });

    const first = queue.rasterize({ frame: videoFrame(1), fps: 30, outputWidth: 100 });
    const second = queue.rasterize({ frame: videoFrame(2), fps: 30, outputWidth: 100 });
    await Promise.resolve();
    expect(events).toEqual(['start:1']);
    releases.shift()?.();
    await first;
    await Promise.resolve();
    expect(events).toEqual(['start:1', 'finish:1', 'start:2']);
    releases.shift()?.();
    await second;
    expect(events).toEqual(['start:1', 'finish:1', 'start:2', 'finish:2']);
  });

  it('continues processing after a failed queued request', async () => {
    const queue = createSerializedFrameRasterQueue(async (request) => {
      if (request.frame === 1) throw new Error('seek failed');
      return { blob: new Blob(), width: 100, height: 50 };
    });

    await expect(queue.rasterize({ frame: videoFrame(1), fps: 30 })).rejects.toThrow('seek failed');
    await expect(queue.rasterize({ frame: videoFrame(2), fps: 30 })).resolves.toMatchObject({ width: 100 });
  });
});
