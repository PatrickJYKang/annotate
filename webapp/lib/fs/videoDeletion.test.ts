import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import board from '../../public/tagging/board.json';
import { frameBoundary, videoFrame } from '../clip/frameMath';
import type { Clip } from '../types/clip';
import type { VideoEntry } from '../types/project';
import { createClipExclusive, mutateClipExclusive, restoreClipExclusive } from './clipRepository';
import { readClip } from './clipStorage';
import { writeTextFile } from './fsAccess';
import { createProject, readProjectManifest } from './projectFolder';
import { mutateProjectManifestExclusive } from './projectManifestRepository';
import { createSerialLockManager, MockFileSystem, type MockFileSystemOptions } from './test/mockFileSystem';
import { hasClipTombstone } from './trash';
import { deleteVideoExclusive } from './videoDeletion';

const video: VideoEntry = {
  id: 'video_main', label: 'Main', file: 'media/main.mp4', fps: 30,
  width: 1920, height: 1080, frameCount: frameBoundary(300), frameCountSource: 'probe',
};
function clip(id = 'clip_main', videoId = video.id): Clip {
  return {
    schema: 'clip.v2', id, videoId, startFrame: videoFrame(0), endFrame: frameBoundary(100),
    tags: { primary: null, facets: {} }, annotations: [],
    pins: [{ id: 'pin_main', frame: videoFrame(10), annotations: [] }],
  };
}
async function fixture(options: MockFileSystemOptions = {}) {
  const fs = new MockFileSystem({}, options);
  await createProject(fs.root, { name: 'Deletion', defaultBoardSource: JSON.stringify(board) });
  await mutateProjectManifestExclusive(fs.root, (latest) => ({ ...latest, videos: [video, {
    ...video, id: 'video_other', file: 'media/other.mp4',
  }] }));
  await writeTextFile(fs.root, ['media', 'main.mp4'], 'original project video bytes');
  await writeTextFile(fs.root, ['media', 'other.mp4'], 'other video');
  await writeTextFile(fs.root, ['original-input.mp4'], 'input untouched');
  await createClipExclusive(fs.root, clip());
  await createClipExclusive(fs.root, clip('clip_other', 'video_other'));
  await writeTextFile(fs.root, ['analysis', 'clips', 'clip_main', 'annotations', 'ann.json'], 'pin annotations');
  await writeTextFile(fs.root, ['analysis', 'clips', 'clip_main', 'pins', 'frame.png'], 'pin raster');
  await writeTextFile(fs.root, ['presentations', 'deck.json'], 'presentation untouched');
  return fs;
}

beforeEach(() => vi.stubGlobal('navigator', { locks: createSerialLockManager() }));
afterEach(() => vi.unstubAllGlobals());

describe('video deletion', () => {
  it('removes only the selected project video and its complete clip folders, preserving decks and input', async () => {
    const fs = await fixture();
    const result = await deleteVideoExclusive(fs.root, video.id);
    expect(result.deletedClipIds).toEqual(['clip_main']);
    expect(result.manifest.videos.map((entry) => entry.id)).toEqual(['video_other']);
    expect(fs.exists('media/main.mp4')).toBe(false);
    expect(fs.exists('analysis/clips/clip_main')).toBe(false);
    expect(fs.exists('analysis/clips/clip_other/clip.json')).toBe(true);
    expect(await fs.readText('media/other.mp4')).toBe('other video');
    expect(await fs.readText('original-input.mp4')).toBe('input untouched');
    expect(await fs.readText('presentations/deck.json')).toBe('presentation untouched');
    expect(await hasClipTombstone(fs.root, 'clip_main')).toBe(true);
    const payload = fs.list('.trash/clips').find((name) => !name.endsWith('.json'))!;
    expect(await fs.readText(`.trash/clips/${payload}/annotations/ann.json`)).toBe('pin annotations');
    expect(await fs.readText(`.trash/clips/${payload}/pins/frame.png`)).toBe('pin raster');
    await expect(restoreClipExclusive(fs.root, 'clip_main')).rejects.toThrow('no longer in this project');
    await expect(createClipExclusive(fs.root, clip('late_clip'))).rejects.toThrow('no longer in this project');
    await expect(mutateClipExclusive(fs.root, 'clip_main', (latest) => latest)).rejects.toMatchObject({ code: 'deleted' });
  });

  for (const failure of ['manifest', 'media', 'second clip'] as const) {
    it(`rolls back clips and manifest on ${failure} failure without removing the media`, async () => {
      let armed = false;
      let failed = false;
      const fail = () => { failed = true; throw new Error('simulated failure'); };
      const fs = await fixture({
        onWrite(path) {
          if (armed && !failed && failure === 'manifest' && path === 'project.json') fail();
        },
        onRemove(path) {
          if (armed && !failed && (
            (failure === 'media' && path === video.file)
            || (failure === 'second clip' && path === 'analysis/clips/clip_second')
          )) fail();
        },
      });
      await createClipExclusive(fs.root, clip('clip_second'));
      const before = await fs.readText('project.json');
      armed = true;
      await expect(deleteVideoExclusive(fs.root, video.id)).rejects.toThrow('simulated failure');
      expect(await fs.readText('project.json')).toBe(before);
      expect(await fs.readText(video.file)).toBe('original project video bytes');
      expect(await fs.readText('analysis/clips/clip_main/annotations/ann.json')).toBe('pin annotations');
      expect((await readClip(fs.root, 'clip_second')).ok).toBe(true);
      expect(await hasClipTombstone(fs.root, 'clip_main')).toBe(false);
      expect(await hasClipTombstone(fs.root, 'clip_second')).toBe(false);
    });
  }

  it('serializes creation and autosaves queued during deletion without resurrecting data', async () => {
    let mediaReached!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => { mediaReached = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const fs = await fixture({ onRemove: async (path) => {
      if (path === video.file) { mediaReached(); await released; }
    } });
    const deleting = deleteVideoExclusive(fs.root, video.id);
    await reached;
    const pending = Promise.allSettled([
      createClipExclusive(fs.root, clip('late_clip')),
      mutateClipExclusive(fs.root, 'clip_main', (latest) => ({ ...latest, label: 'Late save' })),
    ]);
    release();
    await deleting;
    expect((await pending).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(fs.exists('analysis/clips/late_clip')).toBe(false);
    expect(fs.exists('analysis/clips/clip_main')).toBe(false);
  });

  it('keeps concurrent manifest changes and imported videos', async () => {
    const fs = await fixture();
    await Promise.all([
      deleteVideoExclusive(fs.root, video.id),
      mutateProjectManifestExclusive(fs.root, (latest) => ({
        ...latest, name: 'Renamed', videos: [...latest.videos, { ...video, id: 'new_video', file: 'media/new.mp4' }],
      })),
    ]);
    expect(await readProjectManifest(fs.root)).toMatchObject({ ok: true, manifest: {
      name: 'Renamed', videos: [{ id: 'video_other' }, { id: 'new_video' }],
    } });
  });

  it('can delete an entry whose media is already missing', async () => {
    const fs = await fixture();
    await (await fs.root.getDirectoryHandle('media')).removeEntry('main.mp4');
    await expect(deleteVideoExclusive(fs.root, video.id)).resolves.toMatchObject({ deletedClipIds: ['clip_main'] });
  });

  it('retains a media file referenced by another video entry', async () => {
    const fs = await fixture();
    await mutateProjectManifestExclusive(fs.root, (latest) => ({ ...latest, videos: [...latest.videos, { ...video, id: 'shared_video' }] }));
    await deleteVideoExclusive(fs.root, video.id);
    expect(fs.exists(video.file)).toBe(true);
  });

  it('refuses unreadable clips before making any deletion', async () => {
    const fs = await fixture();
    await writeTextFile(fs.root, ['analysis', 'clips', 'broken', 'clip.json'], '{bad');
    await expect(deleteVideoExclusive(fs.root, video.id)).rejects.toThrow('could not be read');
    expect(fs.exists(video.file)).toBe(true);
    expect(fs.exists('analysis/clips/clip_main')).toBe(true);
  });

  it('refuses path traversal and directories masquerading as media', async () => {
    const fs = await fixture();
    await expect(deleteVideoExclusive(fs.root, '../video_main')).rejects.toThrow('Unsafe');
    await (await fs.root.getDirectoryHandle('media')).removeEntry('main.mp4');
    await writeTextFile(fs.root, ['media', 'main.mp4', 'keep.txt'], 'keep');
    await expect(deleteVideoExclusive(fs.root, video.id)).rejects.toMatchObject({ name: 'TypeMismatchError' });
    expect(await fs.readText('media/main.mp4/keep.txt')).toBe('keep');
    expect((await readClip(fs.root, 'clip_main')).ok).toBe(true);
  });

  it('dispatches native deletion through its dedicated domain command', async () => {
    const fs = await fixture();
    const command = vi.fn().mockResolvedValue({ deletedClipIds: ['clip_main'] });
    await deleteVideoExclusive({ ...fs.root, command }, video.id);
    expect(command).toHaveBeenCalledWith('video.delete', ['video_main']);
    expect(fs.exists(video.file)).toBe(true);
  });
});
