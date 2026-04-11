import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DerivedMediaGenerationRequest,
  DerivedMediaJobQueueFile,
  ExactMotionAssetIndexFile,
  PlaybackAssetRegistry,
  PreferredPlaybackAssetIdByVideoId,
  ResolvedPlaybackAsset,
} from './derivedMediaTypes';
import { promoteExactMotionJobIfCurrent } from '../fs/derivedMediaStorage';
import {
  enqueueDerivedMediaGenerationRequest,
  isQueuedExactMotionJobCurrentForPromotion,
} from './derivedMediaJobs';
import {
  buildExactMotionRelativePath,
  buildExactTransitionGenerationKey,
} from './derivedMediaKeys';
import {
  buildPlaybackAssetLeaseKey,
  createPlaybackAssetObjectUrlRegistry,
  detachVideoElementIfUsingUrl,
} from './playbackAssetObjectUrls';
import {
  buildOriginalPlaybackAssetId,
  resolveAuthoringRetrievalPlaybackAsset,
  resolveAuthoringTransitionPreviewPlaybackAsset,
} from './playbackAssetResolver';

function makeAsset(
  overrides: Partial<ResolvedPlaybackAsset> & Pick<ResolvedPlaybackAsset, 'assetId' | 'assetClass' | 'readiness' | 'qualityClass' | 'safeForPresent'>,
): ResolvedPlaybackAsset {
  return {
    assetId: overrides.assetId,
    assetClass: overrides.assetClass,
    readiness: overrides.readiness,
    qualityClass: overrides.qualityClass,
    safeForPresent: overrides.safeForPresent,
    sourceVideoId: overrides.sourceVideoId,
    filePath: overrides.filePath,
    objectUrl: overrides.objectUrl,
    durationMs: overrides.durationMs,
    sourceFingerprint: overrides.sourceFingerprint,
    generationKey: overrides.generationKey,
    fallbackFromAssetId: overrides.fallbackFromAssetId,
    failureReason: overrides.failureReason,
  };
}

function makeExactMotionRequest(overrides: Partial<DerivedMediaGenerationRequest> = {}): DerivedMediaGenerationRequest {
  return {
    kind: 'exact_motion_generate',
    generationKey: 'generation-key-1',
    sourceFingerprint: 'fingerprint-1',
    presentationId: 'pres-1',
    motionKind: 'transition',
    transitionOrClipId: 'transition-1',
    sourceVideoId: 'video-1',
    outputPath: 'derived-media/presentations/pres-1/motion-assets/motion-generation-key-1.mp4',
    profileVersion: 'exact-v1',
    bounds: {
      startMs: 1000,
      endMs: 2000,
    },
    ...overrides,
  } as DerivedMediaGenerationRequest;
}

function makeQueue(): DerivedMediaJobQueueFile {
  return {
    schema: 1,
    jobs: [],
  };
}

describe('createPlaybackAssetObjectUrlRegistry', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:derived-motion-1');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('reuses the same object URL for repeated leases of the same exact asset', async () => {
    const getFileForPath = vi.fn(async () => new File(['motion'], 'motion.mp4', { type: 'video/mp4' }));
    const registry = createPlaybackAssetObjectUrlRegistry({
      projectDir: {} as FileSystemDirectoryHandle,
      getFileForPath,
    });
    const asset = makeAsset({
      assetId: 'exact_motion:pres-1:transition-1:generation-key-1',
      assetClass: 'exact_motion',
      readiness: 'ready',
      qualityClass: 'exact',
      safeForPresent: true,
      sourceVideoId: 'video-1',
      filePath: 'derived-media/presentations/pres-1/motion-assets/motion-generation-key-1.mp4',
    });

    const releaseFirst = registry.acquireLease(asset);
    const firstUrl = await registry.ensureObjectUrl(asset);
    releaseFirst();

    const releaseSecond = registry.acquireLease(asset);
    const secondUrl = await registry.ensureObjectUrl(asset);
    releaseSecond();
    registry.dispose();

    expect(firstUrl).toBe('blob:derived-motion-1');
    expect(secondUrl).toBe(firstUrl);
    expect(getFileForPath).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:derived-motion-1');
  });

  it('refreshes the object URL when the same asset id points at a new file path', async () => {
    URL.createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:motion-old')
      .mockReturnValueOnce('blob:motion-new');
    const getFileForPath = vi
      .fn(async (projectDir: FileSystemDirectoryHandle, filePath: string) => new File([filePath], filePath, { type: 'video/mp4' }));
    const registry = createPlaybackAssetObjectUrlRegistry({
      projectDir: {} as FileSystemDirectoryHandle,
      getFileForPath,
    });

    const oldAsset = makeAsset({
      assetId: 'exact_motion:pres-1:transition-1:generation-key-1',
      assetClass: 'exact_motion',
      readiness: 'ready',
      qualityClass: 'exact',
      safeForPresent: true,
      sourceVideoId: 'video-1',
      filePath: 'derived-media/presentations/pres-1/motion-assets/motion-old.mp4',
    });
    const newAsset = {
      ...oldAsset,
      filePath: 'derived-media/presentations/pres-1/motion-assets/motion-new.mp4',
    };

    const releaseOld = registry.acquireLease(oldAsset);
    const firstUrl = await registry.ensureObjectUrl(oldAsset);
    releaseOld();

    const releaseNew = registry.acquireLease(newAsset);
    const secondUrl = await registry.ensureObjectUrl(newAsset);
    releaseNew();
    registry.dispose();

    expect(firstUrl).toBe('blob:motion-old');
    expect(secondUrl).toBe('blob:motion-new');
  });
});

describe('playbackAssetObjectUrls helpers', () => {
  it('buildPlaybackAssetLeaseKey includes the asset id and file path', () => {
    expect(buildPlaybackAssetLeaseKey({
      assetId: 'exact_motion:pres-1:transition-1:generation-key-1',
      assetClass: 'exact_motion',
      readiness: 'ready',
      qualityClass: 'exact',
      safeForPresent: true,
      filePath: 'derived-media/presentations/pres-1/motion-assets/motion-generation-key-1.mp4',
      objectUrl: null,
    })).toBe('exact_motion:pres-1:transition-1:generation-key-1|derived-media/presentations/pres-1/motion-assets/motion-generation-key-1.mp4|');
  });

  it('detachVideoElementIfUsingUrl clears the video element only when the source matches', () => {
    const video = {
      currentSrc: 'blob:motion-url',
      currentAttr: 'blob:motion-url' as string | null,
      getAttribute(name: string) {
        return name === 'src' ? this.currentAttr : null;
      },
      pause: vi.fn(),
      removeAttribute(name: string) {
        if (name === 'src') {
          this.currentAttr = null;
        }
      },
      load: vi.fn(),
    };

    expect(detachVideoElementIfUsingUrl(video, 'blob:other-url')).toBe(false);
    expect(video.getAttribute('src')).toBe('blob:motion-url');

    expect(detachVideoElementIfUsingUrl(video, 'blob:motion-url')).toBe(true);
    expect(video.getAttribute('src')).toBeNull();
  });
});

describe('exact-motion queueing', () => {
  it('marks an older active exact-motion job obsolete when a newer request targets the same motion', () => {
    const firstRequest = makeExactMotionRequest({
      generationKey: 'generation-key-1',
    });
    const secondRequest = makeExactMotionRequest({
      generationKey: 'generation-key-2',
    });
    const firstEnqueue = enqueueDerivedMediaGenerationRequest(makeQueue(), firstRequest, 'interactive');
    const secondEnqueue = enqueueDerivedMediaGenerationRequest(firstEnqueue.queue, secondRequest, 'interactive');

    const obsoleteJob = secondEnqueue.queue.jobs.find((job) => job.snapshot.generationKey === firstRequest.generationKey);
    const currentJob = secondEnqueue.queue.jobs.find((job) => job.snapshot.generationKey === secondRequest.generationKey);

    expect(obsoleteJob?.snapshot.status).toBe('obsolete');
    expect(obsoleteJob?.snapshot.error).toBe('Superseded by a newer exact-motion request');
    expect(currentJob?.snapshot.status).toBe('queued');
  });

  it('treats only the newest exact-motion job as current for promotion', () => {
    const firstEnqueue = enqueueDerivedMediaGenerationRequest(
      makeQueue(),
      makeExactMotionRequest({ generationKey: 'generation-key-1' }),
      'interactive',
    );
    const secondEnqueue = enqueueDerivedMediaGenerationRequest(
      firstEnqueue.queue,
      makeExactMotionRequest({ generationKey: 'generation-key-2' }),
      'interactive',
    );

    expect(isQueuedExactMotionJobCurrentForPromotion(secondEnqueue.queue, firstEnqueue.job.snapshot.jobId)).toBe(false);
    expect(isQueuedExactMotionJobCurrentForPromotion(secondEnqueue.queue, secondEnqueue.job.snapshot.jobId)).toBe(true);
  });

  it('promotes a current exact-motion job to ready', () => {
    const enqueueResult = enqueueDerivedMediaGenerationRequest(
      makeQueue(),
      makeExactMotionRequest({ generationKey: 'generation-key-1' }),
      'interactive',
    );
    const promoted = promoteExactMotionJobIfCurrent({
      presentationId: 'pres-1',
      queue: enqueueResult.queue,
      index: {
        schema: 1,
        entries: [],
      } satisfies ExactMotionAssetIndexFile,
      jobId: enqueueResult.job.snapshot.jobId,
      byteSize: 1234,
      durationMs: 1000,
    });

    expect(promoted.promoted).toBe(true);
    expect(promoted.queue.jobs[0]?.snapshot.status).toBe('ready');
    expect(promoted.index.entries[0]).toMatchObject({
      assetId: 'exact_motion:pres-1:transition-1:generation-key-1',
      generationKey: 'generation-key-1',
      relativePath: buildExactMotionRelativePath('generation-key-1'),
      status: 'ready',
      byteSize: 1234,
      durationMs: 1000,
    });
  });
});

describe('playback resolution', () => {
  it('prefers a ready exact-motion asset for authoring transition preview', () => {
    const sourceFingerprint = 'src:abcdef12';
    const exactGenerationKey = buildExactTransitionGenerationKey({
      presentationId: 'pres-1',
      sourceFingerprint,
      transitionIndex: 0,
      fromSlideId: 'slide-1',
      toSlideId: 'slide-2',
      sourceVideoId: 'video-1',
      startMs: 1000,
      endMs: 2000,
      hideAnnotationsDuringPlayback: false,
    });
    const playbackAssetById: PlaybackAssetRegistry = {
      [buildOriginalPlaybackAssetId('video-1')]: makeAsset({
        assetId: buildOriginalPlaybackAssetId('video-1'),
        assetClass: 'original',
        readiness: 'ready',
        qualityClass: 'exact',
        safeForPresent: true,
        sourceVideoId: 'video-1',
        filePath: 'videos/video-1.mp4',
      }),
      [`exact_motion:pres-1:transition-1:${exactGenerationKey}`]: makeAsset({
        assetId: `exact_motion:pres-1:transition-1:${exactGenerationKey}`,
        assetClass: 'exact_motion',
        readiness: 'ready',
        qualityClass: 'exact',
        safeForPresent: true,
        sourceVideoId: 'video-1',
        filePath: `derived-media/presentations/pres-1/${buildExactMotionRelativePath(exactGenerationKey)}`,
      }),
    };
    const preferredPlaybackAssetIdByVideoId: PreferredPlaybackAssetIdByVideoId = {
      'video-1': `exact_motion:pres-1:transition-1:${exactGenerationKey}`,
    };

    const resolved = resolveAuthoringTransitionPreviewPlaybackAsset({
      videoId: 'video-1',
      playbackAssetById,
      preferredPlaybackAssetIdByVideoId,
    });

    expect(resolved?.assetId).toBe(`exact_motion:pres-1:transition-1:${exactGenerationKey}`);
  });

  it('keeps retrieved-mark preview on the original asset', () => {
    const playbackAssetById: PlaybackAssetRegistry = {
      [buildOriginalPlaybackAssetId('video-1')]: makeAsset({
        assetId: buildOriginalPlaybackAssetId('video-1'),
        assetClass: 'original',
        readiness: 'ready',
        qualityClass: 'exact',
        safeForPresent: true,
        sourceVideoId: 'video-1',
        filePath: 'videos/video-1.mp4',
      }),
    };

    const resolved = resolveAuthoringRetrievalPlaybackAsset({
      videoId: 'video-1',
      playbackAssetById,
      preferredPlaybackAssetIdByVideoId: {},
    });

    expect(resolved?.assetId).toBe(buildOriginalPlaybackAssetId('video-1'));
  });
});
