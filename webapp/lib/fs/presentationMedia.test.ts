import { describe, expect, it } from 'vitest';
import { frameBoundary, videoFrame } from '../clip/frameMath';
import { MockFileSystem } from './test/mockFileSystem';
import {
  readPreparedPresentationAssetFile,
  readPresentationMediaIndex,
  writePreparedPresentationAsset,
} from './presentationMedia';

describe('presentation media v2', () => {
  it('stores exact media with an authoritative absolute source range', async () => {
    const fs = new MockFileSystem();
    const entry = await writePreparedPresentationAsset(fs.root, 'deck', {
      kind: 'clip_slide',
      ownerId: 'slide-a',
      videoId: 'video-a',
      sourceStartFrame: videoFrame(20),
      sourceEndFrame: frameBoundary(50),
    }, new Blob(['exact-video']), new Date('2026-07-11T00:00:00.000Z'));
    expect(entry).toMatchObject({ sourceStartFrame: 20, sourceEndFrame: 50 });
    expect(await readPresentationMediaIndex(fs.root, 'deck')).toEqual({
      schema: 'presentation-media.v2',
      assets: [entry],
    });
    expect(await (await readPreparedPresentationAssetFile(fs.root, 'deck', entry)).text()).toBe('exact-video');
  });
});
