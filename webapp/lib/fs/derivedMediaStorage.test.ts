import { describe, expect, it, vi } from 'vitest';
import {
  buildExactMotionPendingOutputPath,
  buildPreviewProxyPendingOutputPath,
  cleanupPendingPreviewProxyFilesForActiveJobs,
  cleanupPendingExactMotionFilesForActiveJobs,
  readExactMotionAssetIndex,
  readPresentationDerivedMediaJobQueue,
  readPreviewProxyDerivedMediaJobQueue,
  reconcileExactMotionIndexWithCurrentGenerationKeys,
  validateExactMotionAssetIndex,
  validatePreviewProxyIndex,
} from './derivedMediaStorage';
import {
  buildExactMotionAssetId,
  buildPreviewProxyAssetId,
  buildExactMotionRelativePath,
  buildPreviewProxyRelativePath,
} from '../presentation/derivedMediaKeys';
import type {
  DerivedMediaJobQueueFile,
  ExactMotionAssetIndexFile,
  PreviewProxyIndexFile,
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

function makePreviewQueue(): DerivedMediaJobQueueFile {
  return {
    schema: 1,
    jobs: [
      {
        executionMode: 'interactive',
        queuedAt: '2026-03-23T00:00:00.000Z',
        request: {
          kind: 'preview_proxy_generate',
          generationKey: 'preview-generation-key',
          sourceFingerprint: 'fingerprint-1',
          sourceVideoId: 'video-1',
          sourceVideoPath: 'videos/video-1.mp4',
          outputPath: 'derived-media/preview-proxies/proxy-preview-generation-key.mp4',
          profileVersion: 'preview-v1',
        },
        snapshot: {
          jobId: 'dmproxy_1',
          kind: 'preview_proxy_generate',
          generationKey: 'preview-generation-key',
          status: 'queued',
          outputPath: 'derived-media/preview-proxies/proxy-preview-generation-key.mp4',
          profileVersion: 'preview-v1',
          sourceVideoId: 'video-1',
          progress: {
            status: 'queued',
            label: 'Queued',
          },
        },
      },
    ],
  };
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

describe('derivedMediaStorage startup reconciliation', () => {
  it('marks preview proxy jobs ready on read when the final file already exists', async () => {
    const queue = makePreviewQueue();
    queue.jobs[0]!.snapshot.remoteJobId = 'remote-job-1';
    const { root, storage } = createMockFS({
      'derived-media/preview-proxies': {
        'jobs.json': JSON.stringify(queue),
        'proxy-preview-generation-key.mp4': 'video-binary',
      },
    });

    const result = await readPreviewProxyDerivedMediaJobQueue(root);

    expect(result.jobs[0]?.snapshot.status).toBe('ready');
    expect(result.jobs[0]?.snapshot.remoteJobId).toBeUndefined();
    expect(JSON.parse(storage['derived-media/preview-proxies']['jobs.json']).jobs[0].snapshot.status).toBe('ready');
  });

  it('normalizes legacy preview proxy output paths that contain invalid filename characters', async () => {
    const queue = makePreviewQueue();
    queue.jobs[0] = {
      ...queue.jobs[0]!,
      request: {
        ...queue.jobs[0]!.request,
        generationKey: 'preview:legacy-key',
        outputPath: 'derived-media/preview-proxies/proxy-preview:legacy-key.mp4',
      },
      snapshot: {
        ...queue.jobs[0]!.snapshot,
        generationKey: 'preview:legacy-key',
        outputPath: 'derived-media/preview-proxies/proxy-preview:legacy-key.mp4',
      },
    };
    const { root, storage } = createMockFS({
      'derived-media/preview-proxies': {
        'jobs.json': JSON.stringify(queue),
      },
    });

    const result = await readPreviewProxyDerivedMediaJobQueue(root);

    expect(result.jobs[0]?.request.outputPath).toBe(`derived-media/preview-proxies/${buildPreviewProxyRelativePath('preview:legacy-key')}`);
    expect(result.jobs[0]?.snapshot.outputPath).toBe(`derived-media/preview-proxies/${buildPreviewProxyRelativePath('preview:legacy-key')}`);
    expect(JSON.parse(storage['derived-media/preview-proxies']['jobs.json']).jobs[0].request.outputPath).toBe(`derived-media/preview-proxies/${buildPreviewProxyRelativePath('preview:legacy-key')}`);
  });

  it('recovers preview proxy index entries to ready when the file exists but the index is not ready', async () => {
    const index: PreviewProxyIndexFile = {
      schema: 1,
      entries: [
        {
          assetId: 'preview_proxy:video-1:preview-generation-key',
          generationKey: 'preview-generation-key',
          sourceVideoId: 'video-1',
          sourceFingerprint: 'fingerprint-1',
          relativePath: 'proxy-preview-generation-key.mp4',
          status: 'queued',
          profileVersion: 'preview-v1',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
      ],
    };
    const { root, storage } = createMockFS({
      'derived-media/preview-proxies': {
        'index.json': JSON.stringify(index),
        'proxy-preview-generation-key.mp4': 'video-binary',
      },
    });

    const result = await validatePreviewProxyIndex(root);

    expect(result.entries[0]?.status).toBe('ready');
    expect(JSON.parse(storage['derived-media/preview-proxies']['index.json']).entries[0].status).toBe('ready');
  });

  it('backfills a missing preview proxy index entry from the queue when the final file exists', async () => {
    const queue = makePreviewQueue();
    const { root } = createMockFS({
      'derived-media/preview-proxies': {
        'index.json': JSON.stringify({ schema: 1, entries: [] } satisfies PreviewProxyIndexFile),
        'jobs.json': JSON.stringify(queue),
        'proxy-preview-generation-key.mp4': 'video-binary',
      },
    });

    const result = await validatePreviewProxyIndex(root);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      assetId: buildPreviewProxyAssetId('video-1', 'preview-generation-key'),
      generationKey: 'preview-generation-key',
      status: 'ready',
      relativePath: 'proxy-preview-generation-key.mp4',
    });
  });

  it('syncs failed preview proxy jobs back into the index on validation', async () => {
    const queue = makePreviewQueue();
    queue.jobs[0] = {
      ...queue.jobs[0]!,
      snapshot: {
        ...queue.jobs[0]!.snapshot,
        status: 'failed',
        error: 'ffmpeg missing',
      },
    };
    const { root, storage } = createMockFS({
      'derived-media/preview-proxies': {
        'index.json': JSON.stringify({
          schema: 1,
          entries: [
            {
              assetId: 'preview_proxy:video-1:preview-generation-key',
              generationKey: 'preview-generation-key',
              sourceVideoId: 'video-1',
              sourceFingerprint: 'fingerprint-1',
              relativePath: 'proxy-preview-generation-key.mp4',
              status: 'queued',
              profileVersion: 'preview-v1',
              createdAt: '2026-03-23T00:00:00.000Z',
            },
          ],
        } satisfies PreviewProxyIndexFile),
        'jobs.json': JSON.stringify(queue),
      },
    });

    const result = await validatePreviewProxyIndex(root);

    expect(result.entries[0]?.status).toBe('failed');
    expect(result.entries[0]?.error).toBe('ffmpeg missing');
    expect(JSON.parse(storage['derived-media/preview-proxies']['index.json']).entries[0].status).toBe('failed');
  });

  it('cleans up preview-proxy pending files for active jobs during startup cleanup', async () => {
    const queue = makePreviewQueue();
    const pendingPath = buildPreviewProxyPendingOutputPath(queue.jobs[0]!.request.outputPath);
    const pendingName = pendingPath.split('/').pop() ?? 'proxy-preview-generation-key.mp4.pending';
    const { root, storage } = createMockFS({
      'derived-media/preview-proxies': {
        'jobs.json': JSON.stringify(queue),
        [pendingName]: 'pending-video-binary',
      },
    });

    await cleanupPendingPreviewProxyFilesForActiveJobs(root, queue);

    expect(storage['derived-media/preview-proxies'][pendingName]).toBeUndefined();
  });

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

  it('does not delete exact-motion pending files during ordinary queue reads', async () => {
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

    await readPresentationDerivedMediaJobQueue(root, 'pres-1');

    expect(storage['derived-media/presentations/pres-1/motion-assets'][pendingName]).toBe('pending-video-binary');
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
      },
      'derived-media/presentations/pres-1/motion-assets': {
        'motion-exact-generation-key.mp4': 'video-binary',
      },
    });

    const result = await validateExactMotionAssetIndex(root, 'pres-1');

    expect(result.entries[0]?.status).toBe('ready');
    expect(JSON.parse(storage['derived-media/presentations/pres-1']['index.json']).entries[0].status).toBe('ready');
  });

  it('normalizes legacy exact-motion index paths that contain invalid filename characters', async () => {
    const index: ExactMotionAssetIndexFile = {
      schema: 1,
      entries: [
        {
          assetId: 'exact_motion:pres-1:transition-1:motion_transition:legacy-key',
          generationKey: 'motion_transition:legacy-key',
          motionKind: 'transition',
          transitionOrClipId: 'transition-1',
          sourceVideoId: 'video-1',
          sourceFingerprint: 'fingerprint-1',
          relativePath: 'motion-assets/motion-motion_transition:legacy-key.mp4',
          status: 'queued',
          profileVersion: 'exact-v1',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
      ],
    };
    const { root, storage } = createMockFS({
      'derived-media/presentations/pres-1': {
        'index.json': JSON.stringify(index),
      },
    });

    const result = await readExactMotionAssetIndex(root, 'pres-1');

    expect(result.entries[0]?.relativePath).toBe(buildExactMotionRelativePath('motion_transition:legacy-key'));
    expect(JSON.parse(storage['derived-media/presentations/pres-1']['index.json']).entries[0].relativePath).toBe(buildExactMotionRelativePath('motion_transition:legacy-key'));
  });

  it('backfills a missing exact-motion index entry from the queue when the final file exists', async () => {
    const queue = makeExactQueue();
    const { root } = createMockFS({
      'derived-media/presentations/pres-1': {
        'index.json': JSON.stringify({ schema: 1, entries: [] } satisfies ExactMotionAssetIndexFile),
        'jobs.json': JSON.stringify(queue),
      },
      'derived-media/presentations/pres-1/motion-assets': {
        'motion-exact-generation-key.mp4': 'video-binary',
      },
    });

    const result = await validateExactMotionAssetIndex(root, 'pres-1');

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      assetId: buildExactMotionAssetId('pres-1', 'transition-1', 'exact-generation-key'),
      generationKey: 'exact-generation-key',
      status: 'ready',
      relativePath: 'motion-assets/motion-exact-generation-key.mp4',
    });
  });

  it('marks exact-motion entries stale when their generation keys are no longer referenced', async () => {
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
          status: 'ready',
          profileVersion: 'exact-v1',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
      ],
    };
    const { root } = createMockFS({});

    const result = await reconcileExactMotionIndexWithCurrentGenerationKeys(root, 'pres-1', index, new Set());

    expect(result.changed).toBe(true);
    expect(result.index.entries[0]?.status).toBe('stale');
    expect(result.index.entries[0]?.error).toBe('Exact-motion asset is no longer referenced by the current presentation deck');
  });

  it('restores stale exact-motion entries to ready when their generation keys are referenced again and the file exists', async () => {
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
          status: 'stale',
          profileVersion: 'exact-v1',
          createdAt: '2026-03-23T00:00:00.000Z',
          error: 'Exact-motion asset is no longer referenced by the current presentation deck',
        },
      ],
    };
    const { root } = createMockFS({
      'derived-media/presentations/pres-1/motion-assets': {
        'motion-exact-generation-key.mp4': 'video-binary',
      },
    });

    const result = await reconcileExactMotionIndexWithCurrentGenerationKeys(root, 'pres-1', index, new Set(['exact-generation-key']));

    expect(result.changed).toBe(true);
    expect(result.index.entries[0]?.status).toBe('ready');
    expect(result.index.entries[0]?.error).toBeUndefined();
  });
});
