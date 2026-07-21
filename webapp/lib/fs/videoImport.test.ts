import { describe, expect, it } from 'vitest';
import defaultBoardDocument from '../../public/tagging/board.json';
import { createProject, readProjectManifest } from './projectFolder';
import { MockFileSystem } from './test/mockFileSystem';
import { importVideoIntoProject } from './videoImport';

async function project(fileSystem: MockFileSystem) {
  return createProject(fileSystem.root, {
    name: 'Import test',
    defaultBoardSource: JSON.stringify(defaultBoardDocument),
  });
}

const normalized = async () => ({
  blob: new Blob(['normalized-video'], { type: 'video/mp4' }),
  metadata: {
    fps: 30,
    frameCount: 301,
    width: 1920,
    height: 1080,
    durationMs: 30100 / 3,
    frameCountSource: 'normalize' as const,
  },
});

describe('importVideoIntoProject', () => {
  it('commits authoritative metadata and media together', async () => {
    const fileSystem = new MockFileSystem();
    const { manifest } = await project(fileSystem);

    const imported = await importVideoIntoProject(
      fileSystem.root,
      manifest,
      new File(['source'], 'first-half.mov'),
      { prepare: normalized, videoId: 'video_main' },
    );

    expect(imported.video).toMatchObject({
      id: 'video_main',
      file: 'media/first-half.mp4',
      frameCount: 301,
      frameCountSource: 'normalize',
    });
    expect(fileSystem.exists('media/first-half.mp4')).toBe(true);
    expect(await readProjectManifest(fileSystem.root)).toMatchObject({
      ok: true,
      manifest: { videos: [{ id: 'video_main', frameCount: 301 }] },
    });

    await importVideoIntoProject(
      fileSystem.root,
      imported.manifest,
      new File(['second'], 'second-half.mp4'),
      {
        videoId: 'video_second',
        prepare: async () => ({
          blob: new Blob(['second-video'], { type: 'video/mp4' }),
          metadata: {
            fps: 25,
            frameCount: 250,
            width: 1280,
            height: 720,
            durationMs: 10000,
            frameCountSource: 'probe',
            importStrategy: 'preserve',
          },
        }),
      },
    );
    expect(await readProjectManifest(fileSystem.root)).toMatchObject({
      ok: true,
      manifest: {
        videos: [
          { id: 'video_main', fps: 30, width: 1920, height: 1080 },
          { id: 'video_second', fps: 25, width: 1280, height: 720 },
        ],
      },
    });
  });

  it('accepts independent video media contracts and rejects malformed metadata', async () => {
    const fileSystem = new MockFileSystem();
    const { manifest } = await project(fileSystem);
    const source = new File(['source'], 'source.mp4');

    await expect(importVideoIntoProject(fileSystem.root, manifest, source, {
      prepare: async () => { throw new Error('missing authoritative frame count'); },
    })).rejects.toThrow('authoritative frame count');
    expect(fileSystem.list('media')).toEqual([]);

    await expect(importVideoIntoProject(fileSystem.root, manifest, source, {
      prepare: async () => ({
        ...(await normalized()),
        metadata: { ...(await normalized()).metadata, fps: 25, width: 1280, height: 720 },
      }),
    })).resolves.toMatchObject({ video: { fps: 25, width: 1280, height: 720 } });

    await expect(importVideoIntoProject(fileSystem.root, manifest, source, {
      prepare: async () => ({
        ...(await normalized()),
        metadata: { ...(await normalized()).metadata, frameCount: 0 },
      }),
    })).rejects.toThrow('per-video frame contract');
    expect(await readProjectManifest(fileSystem.root)).toMatchObject({
      ok: true,
      manifest: { videos: [{ fps: 25, width: 1280, height: 720 }] },
    });
  });

  it('removes newly written media if the manifest commit fails', async () => {
    let failManifestWrite = false;
    const fileSystem = new MockFileSystem({}, {
      onWrite(path) {
        if (failManifestWrite && path === 'project.json') throw new Error('manifest commit failed');
      },
    });
    const { manifest } = await project(fileSystem);
    failManifestWrite = true;

    await expect(importVideoIntoProject(
      fileSystem.root,
      manifest,
      new File(['source'], 'source.mp4'),
      { prepare: normalized },
    )).rejects.toThrow('manifest commit failed');
    expect(fileSystem.list('media')).toEqual([]);
    expect(await readProjectManifest(fileSystem.root)).toMatchObject({ ok: true, manifest: { videos: [] } });
  });
});
