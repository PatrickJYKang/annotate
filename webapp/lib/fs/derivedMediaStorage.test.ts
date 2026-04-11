import { describe, expect, it, vi } from 'vitest';
import {
  buildExactMotionPendingOutputPath,
  cleanupPendingExactMotionFilesForActiveJobs,
  readExactMotionAssetIndex,
  readPresentationDerivedMediaJobQueue,
  reconcileExactMotionIndexWithCurrentGenerationKeys,
  validateExactMotionAssetIndex,
} from './derivedMediaStorage';
import {
  buildExactMotionAssetId,
  buildExactMotionRelativePath,
} from '../presentation/derivedMediaKeys';
import type {
  DerivedMediaJobQueueFile,
  ExactMotionAssetIndexFile,
} from '../presentation/derivedMediaTypes';

function createMockFS(files: Record<string, Record<string, string>> = {}) {
  const storage: Record<string, Record<string, string>> = { '': {} };

  function ensureDir(dirName: string) {
    if (!(dirName in storage)) {
      storage[dirName] = {};
    }
    if (!dirName) {
      return;
    }
    const parts = dirName.split('/').filter(Boolean);
    while (parts.length > 0) {
      const parent = parts.slice(0, -1).join('/');
      if (!(parent in storage)) {
        storage[parent] = {};
      }
      parts.pop();
    }
  }

  for (const [dirName, dirFiles] of Object.entries(files)) {
    ensureDir(dirName);
    storage[dirName] = {
      ...storage[dirName],
      ...dirFiles,
    };
  }

  function makeDirHandle(dirName: string): FileSystemDirectoryHandle {
    return {
      kind: 'directory',
      name: dirName.split('/').filter(Boolean).pop() ?? '',
      getDirectoryHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
        const key = dirName ? `${dirName}/${name}` : name;
        if (!(key in storage)) {
          if (opts?.create) {
            ensureDir(key);
          } else {
            throw new DOMException('Not found', 'NotFoundError');
          }
        }
        return makeDirHandle(key);
      }),
      getFileHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
        ensureDir(dirName);
        if (!(name in storage[dirName])) {
          if (opts?.create) {
            storage[dirName][name] = '';
          } else {
            throw new DOMException('Not found', 'NotFoundError');
          }
        }
        return makeFileHandle(dirName, name);
      }),
      removeEntry: vi.fn(async (name: string) => {
        if (!(name in storage[dirName])) {
          throw new DOMException('Not found', 'NotFoundError');
        }
        delete storage[dirName][name];
      }),
      entries: vi.fn(async function* () {
        const dir = storage[dirName];
        if (!dir) return;
        for (const [name] of Object.entries(dir)) {
          yield [name, makeFileHandle(dirName, name)] as [string, FileSystemFileHandle];
        }
      }),
    } as unknown as FileSystemDirectoryHandle;
  }

  function makeFileHandle(dirName: string, fileName: string): FileSystemFileHandle {
    return {
      kind: 'file',
      name: fileName,
      getFile: vi.fn(async () => ({
        text: async () => storage[dirName]?.[fileName] ?? '',
        lastModified: Date.now(),
      })),
      createWritable: vi.fn(async () => {
        let written = '';
        return {
          write: async (data: string) => {
            written += data;
          },
          close: async () => {
            ensureDir(dirName);
            storage[dirName][fileName] = written;
          },
        };
      }),
    } as unknown as FileSystemFileHandle;
  }

  return { root: makeDirHandle(''), storage };
}

function makeExactQueue(): DerivedMediaJobQueueFile {
  return {
    schema: 1,
    jobs: [
      {
        executionMode: 'prepare_presentation',
        queuedAt: '2026-03-23T00:00:00.000Z',
        request: {
          kind: 'exact_motion_generate',
          generationKey: 'exact-generation-key',
          sourceFingerprint: 'fingerprint-1',
          presentationId: 'pres-1',
          motionKind: 'transition',
          transitionOrClipId: 'transition-1',
          sourceVideoId: 'video-1',
          outputPath: 'derived-media/presentations/pres-1/motion-assets/motion-exact-generation-key.mp4',
          profileVersion: 'exact-v1',
          bounds: {
            startMs: 1000,
            endMs: 2000,
          },
        },
        snapshot: {
          jobId: 'dmexact_1',
          kind: 'exact_motion_generate',
          generationKey: 'exact-generation-key',
          status: 'queued',
          outputPath: 'derived-media/presentations/pres-1/motion-assets/motion-exact-generation-key.mp4',
          profileVersion: 'exact-v1',
          sourceVideoId: 'video-1',
          presentationId: 'pres-1',
          motionKind: 'transition',
          transitionOrClipId: 'transition-1',
          bounds: {
            startMs: 1000,
            endMs: 2000,
          },
          progress: {
            status: 'queued',
            label: 'Queued',
          },
        },
      },
    ],
  };
}

describe('derivedMediaStorage exact-motion reconciliation', () => {
  it('marks exact-motion jobs ready on read when the final file already exists', async () => {
    const queue = makeExactQueue();
    const { root, storage } = createMockFS({
      'derived-media/presentations/pres-1': {
        'jobs.json': JSON.stringify(queue),
        'index.json': JSON.stringify({ schema: 1, entries: [] } satisfies ExactMotionAssetIndexFile),
      },
      'derived-media/presentations/pres-1/motion-assets': {
        'motion-exact-generation-key.mp4': 'video-binary',
      },
    });

    const result = await readPresentationDerivedMediaJobQueue(root, 'pres-1');

    expect(result.jobs[0]?.snapshot.status).toBe('ready');
    expect(JSON.parse(storage['derived-media/presentations/pres-1']['jobs.json']).jobs[0].snapshot.status).toBe('ready');
  });

  it('cleans up exact-motion pending files for active jobs during startup cleanup', async () => {
    const queue = makeExactQueue();
    const pendingPath = buildExactMotionPendingOutputPath(queue.jobs[0]!.request.outputPath);
    const pendingName = pendingPath.split('/').pop() ?? 'motion-exact-generation-key.mp4.pending';
    const { root, storage } = createMockFS({
      'derived-media/presentations/pres-1': {
        'jobs.json': JSON.stringify(queue),
      },
      'derived-media/presentations/pres-1/motion-assets': {
        [pendingName]: 'pending-video-binary',
      },
    });

    await cleanupPendingExactMotionFilesForActiveJobs(root, 'pres-1', queue);

    expect(storage['derived-media/presentations/pres-1/motion-assets'][pendingName]).toBeUndefined();
  });

  it('recovers exact-motion index entries to ready when the file exists but the index is not ready', async () => {
    const index: ExactMotionAssetIndexFile = {
      schema: 1,
      entries: [
        {
          assetId: 'exact_motion:pres-1:transition-1:exact-generation-key',
          generationKey: 'exact-generation-key',
          motionKind: 'transition',
          transitionOrClipId: 'transition-1',
          sourceVideoId: 'video-1',
          sourceFingerprint: 'fingerprint-1',
          relativePath: 'motion-assets/motion-exact-generation-key.mp4',
          status: 'queued',
          profileVersion: 'exact-v1',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
      ],
    };
    const { root, storage } = createMockFS({
      'derived-media/presentations/pres-1': {
        'index.json': JSON.stringify(index),
        'jobs.json': JSON.stringify({ schema: 1, jobs: [] } satisfies DerivedMediaJobQueueFile),
      },
      'derived-media/presentations/pres-1/motion-assets': {
        'motion-exact-generation-key.mp4': 'video-binary',
      },
    });

    const result = await validateExactMotionAssetIndex(root, 'pres-1');

    expect(result.entries[0]?.status).toBe('ready');
    expect(JSON.parse(storage['derived-media/presentations/pres-1']['index.json']).entries[0].status).toBe('ready');
  });

  it('normalizes exact-motion relative paths when reading the index', async () => {
    const index: ExactMotionAssetIndexFile = {
      schema: 1,
      entries: [
        {
          assetId: buildExactMotionAssetId('pres-1', 'transition-1', 'exact-generation-key'),
          generationKey: 'exact-generation-key',
          motionKind: 'transition',
          transitionOrClipId: 'transition-1',
          sourceVideoId: 'video-1',
          sourceFingerprint: 'fingerprint-1',
          relativePath: 'motion-assets/legacy-name.mp4',
          status: 'ready',
          profileVersion: 'exact-v1',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
      ],
    };
    const { root } = createMockFS({
      'derived-media/presentations/pres-1': {
        'index.json': JSON.stringify(index),
      },
    });

    const result = await readExactMotionAssetIndex(root, 'pres-1');

    expect(result.entries[0]?.relativePath).toBe(buildExactMotionRelativePath('exact-generation-key'));
  });

  it('marks unreferenced exact-motion entries stale', async () => {
    const index: ExactMotionAssetIndexFile = {
      schema: 1,
      entries: [
        {
          assetId: buildExactMotionAssetId('pres-1', 'transition-1', 'exact-generation-key'),
          generationKey: 'exact-generation-key',
          motionKind: 'transition',
          transitionOrClipId: 'transition-1',
          sourceVideoId: 'video-1',
          sourceFingerprint: 'fingerprint-1',
          relativePath: buildExactMotionRelativePath('exact-generation-key'),
          status: 'ready',
          profileVersion: 'exact-v1',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
      ],
    };
    const { root } = createMockFS();

    const result = await reconcileExactMotionIndexWithCurrentGenerationKeys(root, 'pres-1', index, new Set());

    expect(result.changed).toBe(true);
    expect(result.index.entries[0]?.status).toBe('stale');
  });
});
