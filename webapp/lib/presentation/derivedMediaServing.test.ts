import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clip } from '../types/clip';
import type { ProjectManifestV1 } from '../types/project';
import type { Presentation } from '../types/presentation';
import type {
  DerivedMediaGenerationRequest,
  DerivedMediaJobQueueFile,
  ExactMotionAssetIndexFile,
  PreviewProxyIndexFile,
  PlaybackAssetRegistry,
  PreferredPlaybackAssetIdByVideoId,
  ResolvedPlaybackAsset,
} from './derivedMediaTypes';
import { promoteExactMotionJobIfCurrent, promotePreviewProxyJobIfCurrent } from '../fs/derivedMediaStorage';
import {
  enqueueDerivedMediaGenerationRequest,
  isQueuedExactMotionJobCurrentForPromotion,
  isQueuedPreviewProxyJobCurrentForPromotion,
} from './derivedMediaJobs';
import {
  LARGE_SOURCE_BYTE_SIZE_THRESHOLD,
  LARGE_SOURCE_DURATION_THRESHOLD_MS,
  shouldGeneratePreviewProxyNow,
} from './derivedMediaConfig';
import {
  buildExactMotionRelativePath,
  buildExactClipGenerationKey,
  buildExactTransitionGenerationKey,
  buildPreviewProxyGenerationKey,
  buildPreviewProxyRelativePath,
} from './derivedMediaKeys';
import {
  buildPlaybackAssetLeaseKey,
  createPlaybackAssetObjectUrlRegistry,
  detachVideoElementIfUsingUrl,
} from './playbackAssetObjectUrls';
import {
  buildClipPlaybackPreferenceKey,
  buildTransitionPlaybackPreferenceKey,
  findReadyExactTransitionPlaybackAsset,
  findReadyPreviewProxyPlaybackAsset,
  resolvePlaybackAssetForVideoId,
} from './playbackAssetResolver';
import {
  buildPresentationPreparationStatusLabel,
  buildPresentationPreparationSummary,
  buildPreparePresentationExactMotionRequest,
  buildPresentationPreparationStatusRecord,
  collectPresentClosureRequirements,
  evaluatePresentClosureRequirements,
} from './presentPreparation';
import {
  buildInteractivePreviewProxyGenerationPlan,
  countPresentationVideoReferences,
} from './previewProxyPlanning';

function makeAsset(overrides: Partial<ResolvedPlaybackAsset> & Pick<ResolvedPlaybackAsset, 'assetId' | 'assetClass' | 'readiness' | 'qualityClass' | 'safeForPresent'>): ResolvedPlaybackAsset {
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

function makePresentation(): Presentation {
  return {
    schema: 1,
    id: 'pres-1',
    name: 'Presentation',
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
    slides: [
      {
        id: 'slide-1',
        kind: 'clip',
        clipId: 'clip-1',
      },
    ],
    transitions: [],
  };
}

function makeManifest(): ProjectManifestV1 {
  return {
    schema: 'project.v1',
    name: 'Project',
    created: '2026-03-23T00:00:00.000Z',
    videos: [
      {
        id: 'video-1',
        label: 'Video 1',
        file: 'videos/video-1.mp4',
      },
    ],
    marks: [],
    stills: [],
    annotations: [],
    reports: [],
    thumbnails: [],
  };
}

function makeClip(): Clip {
  return {
    schema: 1,
    id: 'clip-1',
    videoId: 'video-1',
    startMs: 1000,
    endMs: 4000,
    annotations: [],
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

function makePreviewProxyRequest(overrides: Partial<DerivedMediaGenerationRequest> = {}): DerivedMediaGenerationRequest {
  return {
    kind: 'preview_proxy_generate',
    generationKey: 'preview-generation-key-1',
    sourceFingerprint: 'fingerprint-1',
    sourceVideoId: 'video-1',
    outputPath: 'derived-media/preview-proxies/proxy-preview-generation-key-1.mp4',
    profileVersion: 'preview-v1',
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
    URL.createObjectURL = vi.fn(() => 'blob:derived-proxy-1');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('reuses the same object URL for repeated leases of the same asset', async () => {
    const getFileForPath = vi.fn(async () => new File(['proxy'], 'proxy.mp4', { type: 'video/mp4' }));
    const registry = createPlaybackAssetObjectUrlRegistry({
      projectDir: {} as FileSystemDirectoryHandle,
      getFileForPath,
    });
    const asset = makeAsset({
      assetId: 'proxy:video-1',
      assetClass: 'preview_proxy',
      readiness: 'ready',
      qualityClass: 'degraded',
      safeForPresent: false,
      sourceVideoId: 'video-1',
      filePath: 'derived-media/preview-proxies/video-1.mp4',
    });

    const releaseFirst = registry.acquireLease(asset);
    const firstUrl = await registry.ensureObjectUrl(asset);
    releaseFirst();

    const releaseSecond = registry.acquireLease(asset);
    const secondUrl = await registry.ensureObjectUrl(asset);
    releaseSecond();
    registry.dispose();

    expect(firstUrl).toBe('blob:derived-proxy-1');
    expect(secondUrl).toBe(firstUrl);
    expect(getFileForPath).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:derived-proxy-1');
  });

  it('does not create an object URL until playback actually needs one', async () => {
    const getFileForPath = vi.fn(async () => new File(['proxy'], 'proxy.mp4', { type: 'video/mp4' }));
    const registry = createPlaybackAssetObjectUrlRegistry({
      projectDir: {} as FileSystemDirectoryHandle,
      getFileForPath,
    });
    const asset = makeAsset({
      assetId: 'proxy:video-1',
      assetClass: 'preview_proxy',
      readiness: 'ready',
      qualityClass: 'degraded',
      safeForPresent: false,
      sourceVideoId: 'video-1',
      filePath: 'derived-media/preview-proxies/video-1.mp4',
    });

    const release = registry.acquireLease(asset);

    expect(getFileForPath).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    await registry.ensureObjectUrl(asset);

    expect(getFileForPath).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    release();
    registry.dispose();
  });

  it('revokes a late object URL and returns null if the registry is disposed during load', async () => {
    let resolveFile: ((file: File) => void) | null = null;
    const getFileForPath = vi.fn(() => new Promise<File>((resolve) => {
      resolveFile = resolve;
    }));
    const registry = createPlaybackAssetObjectUrlRegistry({
      projectDir: {} as FileSystemDirectoryHandle,
      getFileForPath,
    });
    const asset = makeAsset({
      assetId: 'exact:video-1',
      assetClass: 'exact_motion',
      readiness: 'ready',
      qualityClass: 'exact',
      safeForPresent: true,
      sourceVideoId: 'video-1',
      filePath: 'derived-media/presentations/pres-1/motion-assets/exact-1.mp4',
    });

    const pendingUrl = registry.ensureObjectUrl(asset);
    registry.dispose();
    const completeLoad = resolveFile as ((file: File) => void) | null;
    if (typeof completeLoad === 'function') {
      completeLoad(new File(['exact'], 'exact.mp4', { type: 'video/mp4' }));
    }

    await expect(pendingUrl).resolves.toBeNull();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:derived-proxy-1');
  });

  it('can resolve a fresh object URL after disposal clears the previous registry state', async () => {
    const getFileForPath = vi.fn(async (_projectDir: FileSystemDirectoryHandle, path: string) => {
      const name = path.split('/').pop() ?? 'video.mp4';
      return new File([path], name, { type: 'video/mp4' });
    });
    URL.createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:derived-proxy-1')
      .mockReturnValueOnce('blob:derived-proxy-2');
    const registry = createPlaybackAssetObjectUrlRegistry({
      projectDir: {} as FileSystemDirectoryHandle,
      getFileForPath,
    });
    const asset = makeAsset({
      assetId: 'proxy:video-1',
      assetClass: 'preview_proxy',
      readiness: 'ready',
      qualityClass: 'degraded',
      safeForPresent: false,
      sourceVideoId: 'video-1',
      filePath: 'derived-media/preview-proxies/video-1.mp4',
    });

    const releaseFirst = registry.acquireLease(asset);
    await expect(registry.ensureObjectUrl(asset)).resolves.toBe('blob:derived-proxy-1');
    releaseFirst();
    registry.dispose();

    const releaseSecond = registry.acquireLease(asset);
    await expect(registry.ensureObjectUrl(asset)).resolves.toBe('blob:derived-proxy-2');
    releaseSecond();
    registry.dispose();

    expect(getFileForPath).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:derived-proxy-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:derived-proxy-2');
  });

  it('treats URL-like file paths as direct object URLs and skips filesystem loading', async () => {
    const getFileForPath = vi.fn(async () => new File(['proxy'], 'proxy.mp4', { type: 'video/mp4' }));
    const registry = createPlaybackAssetObjectUrlRegistry({
      projectDir: {} as FileSystemDirectoryHandle,
      getFileForPath,
    });
    const asset = makeAsset({
      assetId: 'original:video-1',
      assetClass: 'original',
      readiness: 'ready',
      qualityClass: 'exact',
      safeForPresent: true,
      sourceVideoId: 'video-1',
      filePath: 'blob:http://localhost:3000/direct-video-url',
    });

    const release = registry.acquireLease(asset);
    await expect(registry.ensureObjectUrl(asset)).resolves.toBe('blob:http://localhost:3000/direct-video-url');

    expect(getFileForPath).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    release();
    registry.dispose();
  });

  it('does not revoke a direct blob URL that the registry did not create', async () => {
    const getFileForPath = vi.fn(async () => new File(['proxy'], 'proxy.mp4', { type: 'video/mp4' }));
    const registry = createPlaybackAssetObjectUrlRegistry({
      projectDir: {} as FileSystemDirectoryHandle,
      getFileForPath,
    });
    const asset = makeAsset({
      assetId: 'original:video-1',
      assetClass: 'original',
      readiness: 'ready',
      qualityClass: 'exact',
      safeForPresent: true,
      sourceVideoId: 'video-1',
      filePath: 'blob:http://localhost:3000/direct-video-url',
    });

    const release = registry.acquireLease(asset);
    await expect(registry.ensureObjectUrl(asset)).resolves.toBe('blob:http://localhost:3000/direct-video-url');

    release();
    registry.dispose();

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('does not reuse a stale blob URL when the same asset id switches to a new file path', async () => {
    const getFileForPath = vi.fn(async (_projectDir: FileSystemDirectoryHandle, path: string) => {
      const name = path.split('/').pop() ?? 'video.mp4';
      return new File([path], name, { type: 'video/mp4' });
    });
    URL.createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:derived-proxy-1')
      .mockReturnValueOnce('blob:derived-proxy-2');
    const registry = createPlaybackAssetObjectUrlRegistry({
      projectDir: {} as FileSystemDirectoryHandle,
      getFileForPath,
    });
    const firstAsset = makeAsset({
      assetId: 'original:video-1',
      assetClass: 'original',
      readiness: 'ready',
      qualityClass: 'exact',
      safeForPresent: true,
      sourceVideoId: 'video-1',
      filePath: 'videos/source-a.mp4',
    });
    const secondAsset = makeAsset({
      assetId: 'original:video-1',
      assetClass: 'original',
      readiness: 'ready',
      qualityClass: 'exact',
      safeForPresent: true,
      sourceVideoId: 'video-1',
      filePath: 'videos/source-b.mp4',
    });

    const releaseFirst = registry.acquireLease(firstAsset);
    await expect(registry.ensureObjectUrl(firstAsset)).resolves.toBe('blob:derived-proxy-1');

    const releaseSecond = registry.acquireLease(secondAsset);
    await expect(registry.ensureObjectUrl(secondAsset)).resolves.toBe('blob:derived-proxy-2');

    releaseSecond();
    releaseFirst();
    registry.dispose();
  });

  it('recreates an owned blob URL after invalidation', async () => {
    const getFileForPath = vi.fn(async (_projectDir: FileSystemDirectoryHandle, path: string) => {
      const name = path.split('/').pop() ?? 'video.mp4';
      return new File([path], name, { type: 'video/mp4' });
    });
    URL.createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:derived-proxy-1')
      .mockReturnValueOnce('blob:derived-proxy-2');
    const registry = createPlaybackAssetObjectUrlRegistry({
      projectDir: {} as FileSystemDirectoryHandle,
      getFileForPath,
    });
    const asset = makeAsset({
      assetId: 'proxy:video-1',
      assetClass: 'preview_proxy',
      readiness: 'ready',
      qualityClass: 'degraded',
      safeForPresent: false,
      sourceVideoId: 'video-1',
      filePath: 'derived-media/preview-proxies/video-1.mp4',
    });

    const release = registry.acquireLease(asset);
    await expect(registry.ensureObjectUrl(asset)).resolves.toBe('blob:derived-proxy-1');
    expect(registry.invalidateObjectUrl(asset, 'blob:derived-proxy-1')).toBe(true);
    await expect(registry.ensureObjectUrl(asset)).resolves.toBe('blob:derived-proxy-2');

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:derived-proxy-1');
    expect(getFileForPath).toHaveBeenCalledTimes(2);

    release();
    registry.dispose();
  });
});

describe('playback lease lifecycle helpers', () => {
  it('builds the same lease key for equivalent asset snapshots', () => {
    const first = makeAsset({
      assetId: 'exact:1',
      assetClass: 'exact_motion',
      readiness: 'ready',
      qualityClass: 'exact',
      safeForPresent: true,
      filePath: 'derived-media/presentations/pres-1/motion-assets/exact-1.mp4',
    });
    const second = makeAsset({
      assetId: 'exact:1',
      assetClass: 'exact_motion',
      readiness: 'ready',
      qualityClass: 'exact',
      safeForPresent: true,
      filePath: 'derived-media/presentations/pres-1/motion-assets/exact-1.mp4',
    });

    expect(buildPlaybackAssetLeaseKey(first)).toBe(buildPlaybackAssetLeaseKey(second));
  });

  it('detaches a video element before a blob URL lease is released', () => {
    const pause = vi.fn();
    const removeAttribute = vi.fn();
    const load = vi.fn();
    const element = {
      currentSrc: 'blob:http://localhost:3000/current-video',
      getAttribute: vi.fn((name: string) => name === 'src' ? 'blob:http://localhost:3000/current-video' : null),
      pause,
      removeAttribute,
      load,
    };

    expect(detachVideoElementIfUsingUrl(element as unknown as HTMLVideoElement, 'blob:http://localhost:3000/current-video')).toBe(true);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(removeAttribute).toHaveBeenCalledWith('src');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not detach a video element when it is no longer using the blob URL', () => {
    const pause = vi.fn();
    const removeAttribute = vi.fn();
    const load = vi.fn();
    const element = {
      currentSrc: 'blob:http://localhost:3000/next-video',
      getAttribute: vi.fn((name: string) => name === 'src' ? 'blob:http://localhost:3000/next-video' : null),
      pause,
      removeAttribute,
      load,
    };

    expect(detachVideoElementIfUsingUrl(element as unknown as HTMLVideoElement, 'blob:http://localhost:3000/old-video')).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
});

describe('preview proxy large-source gate', () => {
  it('defers full proxy generation on first light interaction for a large source', () => {
    expect(shouldGeneratePreviewProxyNow({
      durationMs: LARGE_SOURCE_DURATION_THRESHOLD_MS + 1,
      byteSize: LARGE_SOURCE_BYTE_SIZE_THRESHOLD + 1,
      sessionTouchCount: 1,
      presentationReferenceCount: 1,
      explicitPreparation: false,
    })).toBe(false);
  });

  it('allows generation on the second meaningful touch for a large source', () => {
    expect(shouldGeneratePreviewProxyNow({
      durationMs: LARGE_SOURCE_DURATION_THRESHOLD_MS + 1,
      sessionTouchCount: 2,
      presentationReferenceCount: 1,
      explicitPreparation: false,
    })).toBe(true);
  });

  it('allows generation once a large source has at least three authored references', () => {
    expect(shouldGeneratePreviewProxyNow({
      byteSize: LARGE_SOURCE_BYTE_SIZE_THRESHOLD + 1,
      sessionTouchCount: 1,
      presentationReferenceCount: 3,
      explicitPreparation: false,
    })).toBe(true);
  });

  it('always allows generation for explicit preparation even on first touch', () => {
    expect(shouldGeneratePreviewProxyNow({
      durationMs: LARGE_SOURCE_DURATION_THRESHOLD_MS + 1,
      sessionTouchCount: 1,
      presentationReferenceCount: 1,
      explicitPreparation: true,
    })).toBe(true);
  });
});

describe('derived media file naming', () => {
  it('sanitizes derived-media file paths so File System Access API-compatible names are used', () => {
    const previewGenerationKey = buildPreviewProxyGenerationKey('src:abcdef12');
    const exactGenerationKey = buildExactTransitionGenerationKey({
      presentationId: 'pres-1',
      sourceFingerprint: 'src:abcdef12',
      transitionIndex: 0,
      fromSlideId: 'slide-1',
      toSlideId: 'slide-2',
      sourceVideoId: 'video-1',
      startMs: 1000,
      endMs: 2000,
      playbackRate: null,
      startOffsetMs: null,
      endOffsetMs: null,
      hideAnnotationsDuringPlayback: false,
    });

    expect(previewGenerationKey).toContain(':');
    expect(exactGenerationKey).toContain(':');
    expect(buildPreviewProxyRelativePath(previewGenerationKey)).not.toContain(':');
    expect(buildExactMotionRelativePath(exactGenerationKey)).not.toContain(':');
  });
});

describe('preview proxy planning', () => {
  it('counts slide, clip, and playable transition references for a video in the active presentation', () => {
    const presentation: Presentation = {
      schema: 1,
      id: 'pres-1',
      name: 'Presentation',
      createdAt: '2026-03-23T00:00:00.000Z',
      updatedAt: '2026-03-23T00:00:00.000Z',
      slides: [
        { id: 'slide-1', kind: 'still', stillId: 'still-1', showAnnotations: false },
        { id: 'slide-2', kind: 'still', stillId: 'still-2', showAnnotations: false },
        { id: 'slide-3', kind: 'clip', clipId: 'clip-1' },
      ],
      transitions: [
        { mode: 'match_video', hideAnnotationsDuringPlayback: false },
        { mode: 'cut' },
      ],
    };
    const manifest: ProjectManifestV1 = {
      ...makeManifest(),
      stills: [
        {
          id: 'still-1',
          videoId: 'video-1',
          t_ms: 1000,
          file: 'stills/000001.png',
          width: 100,
          height: 100,
        },
        {
          id: 'still-2',
          videoId: 'video-1',
          t_ms: 2000,
          file: 'stills/000002.png',
          width: 100,
          height: 100,
        },
      ],
    };

    expect(countPresentationVideoReferences({
      presentation,
      manifest,
      clipById: {
        'clip-1': makeClip(),
      },
      videoId: 'video-1',
    })).toBe(4);
  });

  it('defers interactive preview proxy enqueue on first touch for a large sparse source', () => {
    const plan = buildInteractivePreviewProxyGenerationPlan({
      videoId: 'video-1',
      sourceFingerprint: 'fingerprint-1',
      sourceVideoPath: 'videos/video-1.mp4',
      previewProxyIndex: {
        schema: 1,
        entries: [],
      },
      previewJobQueue: makeQueue(),
      byteSize: LARGE_SOURCE_BYTE_SIZE_THRESHOLD + 1,
      sessionTouchCount: 1,
      presentationReferenceCount: 1,
    });

    expect(plan.reason).toBe('deferred_large_source');
    expect(plan.request).toBeNull();
  });

  it('creates an interactive preview proxy request on second touch for a large sparse source', () => {
    const plan = buildInteractivePreviewProxyGenerationPlan({
      videoId: 'video-1',
      sourceFingerprint: 'fingerprint-1',
      sourceVideoPath: 'videos/video-1.mp4',
      previewProxyIndex: {
        schema: 1,
        entries: [],
      },
      previewJobQueue: makeQueue(),
      byteSize: LARGE_SOURCE_BYTE_SIZE_THRESHOLD + 1,
      sessionTouchCount: 2,
      presentationReferenceCount: 1,
    });

    expect(plan.reason).toBe('enqueue');
    expect(plan.request).toMatchObject({
      kind: 'preview_proxy_generate',
      sourceVideoId: 'video-1',
      sourceVideoPath: 'videos/video-1.mp4',
    });
  });
});

describe('presentation-scoped playback preference keys', () => {
  it('separates transition playback preferences across presentations', () => {
    const first = buildTransitionPlaybackPreferenceKey({
      presentationId: 'pres-1',
      slotKey: 'transition',
      videoId: 'video-1',
      startMs: 1000,
      endMs: 2000,
    });
    const second = buildTransitionPlaybackPreferenceKey({
      presentationId: 'pres-2',
      slotKey: 'transition',
      videoId: 'video-1',
      startMs: 1000,
      endMs: 2000,
    });

    expect(first).not.toBe(second);
  });

  it('separates clip playback preferences across presentations', () => {
    const first = buildClipPlaybackPreferenceKey({
      presentationId: 'pres-1',
      slideId: 'slide-1',
      videoId: 'video-1',
      startMs: 1000,
      endMs: 2000,
    });
    const second = buildClipPlaybackPreferenceKey({
      presentationId: 'pres-2',
      slideId: 'slide-1',
      videoId: 'video-1',
      startMs: 1000,
      endMs: 2000,
    });

    expect(first).not.toBe(second);
  });
});

describe('derivedMediaJobs', () => {
  it('marks an older active preview-proxy job obsolete when a newer request targets the same video', () => {
    const firstRequest = makePreviewProxyRequest({
      generationKey: 'preview-generation-key-1',
      outputPath: 'derived-media/preview-proxies/proxy-preview-generation-key-1.mp4',
    });
    const secondRequest = makePreviewProxyRequest({
      generationKey: 'preview-generation-key-2',
      outputPath: 'derived-media/preview-proxies/proxy-preview-generation-key-2.mp4',
      sourceFingerprint: 'fingerprint-2',
    });

    const firstEnqueue = enqueueDerivedMediaGenerationRequest(makeQueue(), firstRequest, 'interactive');
    const secondEnqueue = enqueueDerivedMediaGenerationRequest(firstEnqueue.queue, secondRequest, 'interactive');
    const obsoleteJob = secondEnqueue.queue.jobs.find((job) => job.snapshot.generationKey === 'preview-generation-key-1');
    const newestJob = secondEnqueue.queue.jobs.find((job) => job.snapshot.generationKey === 'preview-generation-key-2');

    expect(obsoleteJob?.snapshot.status).toBe('obsolete');
    expect(obsoleteJob?.snapshot.error).toBe('Superseded by a newer preview-proxy request');
    expect(newestJob?.snapshot.status).toBe('queued');
  });

  it('treats an older preview-proxy job as not current for promotion when a newer generation key exists for the same video', () => {
    const firstEnqueue = enqueueDerivedMediaGenerationRequest(
      makeQueue(),
      makePreviewProxyRequest({ generationKey: 'preview-generation-key-1' }),
      'interactive',
    );
    const secondEnqueue = enqueueDerivedMediaGenerationRequest(
      firstEnqueue.queue,
      makePreviewProxyRequest({
        generationKey: 'preview-generation-key-2',
        outputPath: 'derived-media/preview-proxies/proxy-preview-generation-key-2.mp4',
        sourceFingerprint: 'fingerprint-2',
      }),
      'interactive',
    );

    expect(isQueuedPreviewProxyJobCurrentForPromotion(secondEnqueue.queue, firstEnqueue.job.snapshot.jobId)).toBe(false);
    expect(isQueuedPreviewProxyJobCurrentForPromotion(secondEnqueue.queue, secondEnqueue.job.snapshot.jobId)).toBe(true);
  });

  it('marks an older active exact-motion job obsolete when a newer request targets the same transition', () => {
    const firstRequest = makeExactMotionRequest({
      generationKey: 'generation-key-1',
      outputPath: 'derived-media/presentations/pres-1/motion-assets/motion-generation-key-1.mp4',
    });
    const secondRequest = makeExactMotionRequest({
      generationKey: 'generation-key-2',
      outputPath: 'derived-media/presentations/pres-1/motion-assets/motion-generation-key-2.mp4',
      bounds: {
        startMs: 1100,
        endMs: 2100,
      },
    });

    const firstEnqueue = enqueueDerivedMediaGenerationRequest(makeQueue(), firstRequest, 'prepare_presentation');
    const secondEnqueue = enqueueDerivedMediaGenerationRequest(firstEnqueue.queue, secondRequest, 'prepare_presentation');
    const obsoleteJob = secondEnqueue.queue.jobs.find((job) => job.snapshot.generationKey === 'generation-key-1');
    const newestJob = secondEnqueue.queue.jobs.find((job) => job.snapshot.generationKey === 'generation-key-2');

    expect(obsoleteJob?.snapshot.status).toBe('obsolete');
    expect(obsoleteJob?.snapshot.error).toBe('Superseded by a newer exact-motion request');
    expect(newestJob?.snapshot.status).toBe('queued');
  });

  it('treats an older exact-motion job as not current for promotion when a newer generation key exists for the same target', () => {
    const firstEnqueue = enqueueDerivedMediaGenerationRequest(
      makeQueue(),
      makeExactMotionRequest({ generationKey: 'generation-key-1' }),
      'prepare_presentation',
    );
    const secondEnqueue = enqueueDerivedMediaGenerationRequest(
      firstEnqueue.queue,
      makeExactMotionRequest({
        generationKey: 'generation-key-2',
        outputPath: 'derived-media/presentations/pres-1/motion-assets/motion-generation-key-2.mp4',
      }),
      'prepare_presentation',
    );

    expect(isQueuedExactMotionJobCurrentForPromotion(secondEnqueue.queue, firstEnqueue.job.snapshot.jobId)).toBe(false);
    expect(isQueuedExactMotionJobCurrentForPromotion(secondEnqueue.queue, secondEnqueue.job.snapshot.jobId)).toBe(true);
  });
});

describe('preview-proxy ready promotion', () => {
  it('promotes a current preview-proxy job to ready', () => {
    const enqueueResult = enqueueDerivedMediaGenerationRequest(
      makeQueue(),
      makePreviewProxyRequest({ generationKey: 'preview-generation-key-1' }),
      'interactive',
    );

    const promoted = promotePreviewProxyJobIfCurrent({
      queue: enqueueResult.queue,
      index: {
        schema: 1,
        entries: [],
      } satisfies PreviewProxyIndexFile,
      jobId: enqueueResult.job.snapshot.jobId,
      byteSize: 4096,
      durationMs: 120000,
    });

    expect(promoted.promoted).toBe(true);
    expect(promoted.reason).toBe('promoted');
    expect(promoted.queue.jobs[0]?.snapshot.status).toBe('ready');
    expect(promoted.index.entries[0]?.generationKey).toBe('preview-generation-key-1');
    expect(promoted.index.entries[0]?.status).toBe('ready');
    expect(promoted.index.entries[0]?.byteSize).toBe(4096);
    expect(promoted.index.entries[0]?.durationMs).toBe(120000);
  });

  it('refuses to promote a superseded preview-proxy job after the final currentness recheck', () => {
    const firstEnqueue = enqueueDerivedMediaGenerationRequest(
      makeQueue(),
      makePreviewProxyRequest({ generationKey: 'preview-generation-key-1' }),
      'interactive',
    );
    const secondEnqueue = enqueueDerivedMediaGenerationRequest(
      firstEnqueue.queue,
      makePreviewProxyRequest({
        generationKey: 'preview-generation-key-2',
        outputPath: 'derived-media/preview-proxies/proxy-preview-generation-key-2.mp4',
        sourceFingerprint: 'fingerprint-2',
      }),
      'interactive',
    );

    const blocked = promotePreviewProxyJobIfCurrent({
      queue: secondEnqueue.queue,
      index: {
        schema: 1,
        entries: [
          {
            assetId: 'preview-1',
            generationKey: 'preview-generation-key-1',
            sourceVideoId: 'video-1',
            sourceFingerprint: 'fingerprint-1',
            relativePath: 'proxy-preview-generation-key-1.mp4',
            status: 'queued',
            profileVersion: 'preview-v1',
            createdAt: '2026-03-23T00:00:00.000Z',
          },
        ],
      } satisfies PreviewProxyIndexFile,
      jobId: firstEnqueue.job.snapshot.jobId,
      byteSize: 8192,
      durationMs: 180000,
    });

    expect(blocked.promoted).toBe(false);
    expect(blocked.reason).toBe('not_current');
    expect(blocked.queue.jobs.find((job) => job.snapshot.jobId === firstEnqueue.job.snapshot.jobId)?.snapshot.status).toBe('obsolete');
    expect(blocked.index.entries.find((entry) => entry.generationKey === 'preview-generation-key-1')?.status).toBe('stale');
    expect(blocked.index.entries.find((entry) => entry.generationKey === 'preview-generation-key-1')?.error).toBe('Superseded by a newer preview-proxy request');
  });
});

describe('exact-motion ready promotion', () => {
  it('promotes a current exact-motion job to ready', () => {
    const enqueueResult = enqueueDerivedMediaGenerationRequest(
      makeQueue(),
      makeExactMotionRequest({ generationKey: 'generation-key-1' }),
      'prepare_presentation',
    );

    const promoted = promoteExactMotionJobIfCurrent({
      presentationId: 'pres-1',
      queue: enqueueResult.queue,
      index: {
        schema: 1,
        entries: [],
      },
      jobId: enqueueResult.job.snapshot.jobId,
      byteSize: 4096,
      durationMs: 1000,
    });

    expect(promoted.promoted).toBe(true);
    expect(promoted.reason).toBe('promoted');
    expect(promoted.queue.jobs[0]?.snapshot.status).toBe('ready');
    expect(promoted.index.entries[0]?.generationKey).toBe('generation-key-1');
    expect(promoted.index.entries[0]?.status).toBe('ready');
    expect(promoted.index.entries[0]?.byteSize).toBe(4096);
    expect(promoted.index.entries[0]?.durationMs).toBe(1000);
  });

  it('refuses to promote a superseded exact-motion job after the final currentness recheck', () => {
    const firstEnqueue = enqueueDerivedMediaGenerationRequest(
      makeQueue(),
      makeExactMotionRequest({ generationKey: 'generation-key-1' }),
      'prepare_presentation',
    );
    const secondEnqueue = enqueueDerivedMediaGenerationRequest(
      firstEnqueue.queue,
      makeExactMotionRequest({
        generationKey: 'generation-key-2',
        outputPath: 'derived-media/presentations/pres-1/motion-assets/motion-generation-key-2.mp4',
      }),
      'prepare_presentation',
    );

    const blocked = promoteExactMotionJobIfCurrent({
      presentationId: 'pres-1',
      queue: secondEnqueue.queue,
      index: {
        schema: 1,
        entries: [
          {
            assetId: 'exact-1',
            generationKey: 'generation-key-1',
            motionKind: 'transition',
            transitionOrClipId: 'transition-1',
            sourceVideoId: 'video-1',
            sourceFingerprint: 'fingerprint-1',
            relativePath: 'motion-assets/motion-generation-key-1.mp4',
            status: 'queued',
            profileVersion: 'exact-v1',
            createdAt: '2026-03-23T00:00:00.000Z',
          },
        ],
      },
      jobId: firstEnqueue.job.snapshot.jobId,
      byteSize: 8192,
      durationMs: 1200,
    });

    expect(blocked.promoted).toBe(false);
    expect(blocked.reason).toBe('not_current');
    expect(blocked.queue.jobs.find((job) => job.snapshot.jobId === firstEnqueue.job.snapshot.jobId)?.snapshot.status).toBe('obsolete');
    expect(blocked.index.entries.find((entry) => entry.generationKey === 'generation-key-1')?.status).toBe('stale');
    expect(blocked.index.entries.find((entry) => entry.generationKey === 'generation-key-1')?.error).toBe('Superseded by a newer exact-motion request');
  });
});

describe('persisted asset rediscovery helpers', () => {
  it('rebuilds a ready preview proxy asset from index metadata without an eager object URL', () => {
    const sourceFingerprint = 'fingerprint-1';
    const previewAsset = findReadyPreviewProxyPlaybackAsset({
      videoId: 'video-1',
      sourceFingerprint,
      previewProxyEntries: [
        {
          assetId: 'preview-1',
          generationKey: buildPreviewProxyGenerationKey(sourceFingerprint),
          sourceVideoId: 'video-1',
          sourceFingerprint,
          relativePath: 'proxy-preview-1.mp4',
          status: 'ready',
          profileVersion: 'preview-v1',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
      ],
    });

    expect(previewAsset?.assetId).toBe('preview-1');
    expect(previewAsset?.filePath).toBe('derived-media/preview-proxies/proxy-preview-1.mp4');
    expect(previewAsset?.objectUrl).toBeNull();
  });

  it('rebuilds persisted exact transition assets without an eager cached object URL', () => {
    const generationKey = buildExactTransitionGenerationKey({
      presentationId: 'pres-1',
      sourceFingerprint: 'fingerprint-1',
      transitionIndex: 0,
      fromSlideId: 'slide-1',
      toSlideId: 'slide-2',
      sourceVideoId: 'video-1',
      startMs: 1000,
      endMs: 2000,
      playbackRate: null,
      startOffsetMs: null,
      endOffsetMs: null,
      hideAnnotationsDuringPlayback: false,
    });

    const exactAsset = findReadyExactTransitionPlaybackAsset({
      presentationId: 'pres-1',
      transitionIndex: 0,
      fromSlideId: 'slide-1',
      toSlideId: 'slide-2',
      sourceVideoId: 'video-1',
      sourceFingerprint: 'fingerprint-1',
      startMs: 1000,
      endMs: 2000,
      playbackRate: null,
      startOffsetMs: null,
      endOffsetMs: null,
      hideAnnotationsDuringPlayback: false,
      exactMotionEntries: [
        {
          assetId: 'exact-1',
          generationKey,
          motionKind: 'transition',
          transitionOrClipId: 'transition-1',
          sourceVideoId: 'video-1',
          sourceFingerprint: 'fingerprint-1',
          relativePath: 'motion-assets/motion-exact-1.mp4',
          status: 'ready',
          profileVersion: 'exact-v1',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
      ],
    });

    expect(exactAsset?.assetId).toBe('exact-1');
    expect(exactAsset?.filePath).toBe('derived-media/presentations/pres-1/motion-assets/motion-exact-1.mp4');
    expect(exactAsset?.objectUrl).toBeNull();
  });
});

describe('resolvePlaybackAssetForVideoId', () => {
  it('prefers ready exact motion over ready preview proxy for transition preview', () => {
    const playbackAssetById: PlaybackAssetRegistry = {
      exact: makeAsset({
        assetId: 'exact',
        assetClass: 'exact_motion',
        readiness: 'ready',
        qualityClass: 'exact',
        safeForPresent: true,
        sourceVideoId: 'video-1',
      }),
      proxy: makeAsset({
        assetId: 'proxy',
        assetClass: 'preview_proxy',
        readiness: 'ready',
        qualityClass: 'degraded',
        safeForPresent: false,
        sourceVideoId: 'video-1',
      }),
      original: makeAsset({
        assetId: 'original:video-1',
        assetClass: 'original',
        readiness: 'ready',
        qualityClass: 'exact',
        safeForPresent: true,
        sourceVideoId: 'video-1',
      }),
    };
    const preferredPlaybackAssetIdByVideoId: PreferredPlaybackAssetIdByVideoId = {
      'video-1': 'proxy',
    };

    const resolved = resolvePlaybackAssetForVideoId({
      videoId: 'video-1',
      workflow: 'authoring_transition_preview',
      playbackAssetById,
      preferredPlaybackAssetIdByVideoId,
      preferredAssetIds: ['exact', 'proxy'],
    });

    expect(resolved?.assetId).toBe('exact');
  });

  it('degrades to preview proxy when exact motion is not ready in authoring preview', () => {
    const playbackAssetById: PlaybackAssetRegistry = {
      exact: makeAsset({
        assetId: 'exact',
        assetClass: 'exact_motion',
        readiness: 'failed',
        qualityClass: 'exact',
        safeForPresent: true,
        sourceVideoId: 'video-1',
      }),
      proxy: makeAsset({
        assetId: 'proxy',
        assetClass: 'preview_proxy',
        readiness: 'ready',
        qualityClass: 'degraded',
        safeForPresent: false,
        sourceVideoId: 'video-1',
      }),
      'original:video-1': makeAsset({
        assetId: 'original:video-1',
        assetClass: 'original',
        readiness: 'ready',
        qualityClass: 'exact',
        safeForPresent: true,
        sourceVideoId: 'video-1',
      }),
    };

    const resolved = resolvePlaybackAssetForVideoId({
      videoId: 'video-1',
      workflow: 'authoring_transition_preview',
      playbackAssetById,
      preferredPlaybackAssetIdByVideoId: {},
      preferredAssetIds: ['exact', 'proxy'],
    });

    expect(resolved?.assetId).toBe('proxy');
  });

  it('keeps retrieved-mark preview on the original asset even when a preview proxy is ready', () => {
    const playbackAssetById: PlaybackAssetRegistry = {
      proxy: makeAsset({
        assetId: 'proxy',
        assetClass: 'preview_proxy',
        readiness: 'ready',
        qualityClass: 'degraded',
        safeForPresent: false,
        sourceVideoId: 'video-1',
      }),
      'original:video-1': makeAsset({
        assetId: 'original:video-1',
        assetClass: 'original',
        readiness: 'ready',
        qualityClass: 'exact',
        safeForPresent: true,
        sourceVideoId: 'video-1',
      }),
    };

    const resolved = resolvePlaybackAssetForVideoId({
      videoId: 'video-1',
      workflow: 'authoring_retrieval',
      playbackAssetById,
      preferredPlaybackAssetIdByVideoId: {
        'video-1': 'proxy',
      },
      preferredAssetIds: ['proxy'],
    });

    expect(resolved?.assetId).toBe('original:video-1');
  });

  it('refuses original fallback in prepared present mode when no exact motion asset is ready', () => {
    const playbackAssetById: PlaybackAssetRegistry = {
      'original:video-1': makeAsset({
        assetId: 'original:video-1',
        assetClass: 'original',
        readiness: 'ready',
        qualityClass: 'exact',
        safeForPresent: true,
        sourceVideoId: 'video-1',
      }),
      proxy: makeAsset({
        assetId: 'proxy',
        assetClass: 'preview_proxy',
        readiness: 'ready',
        qualityClass: 'degraded',
        safeForPresent: false,
        sourceVideoId: 'video-1',
      }),
    };

    const resolved = resolvePlaybackAssetForVideoId({
      videoId: 'video-1',
      workflow: 'present_transition',
      playbackAssetById,
      preferredPlaybackAssetIdByVideoId: {
        'video-1': 'proxy',
      },
      allowFallbackToOriginal: false,
      preferredAssetIds: ['exact-missing', 'proxy'],
    });

    expect(resolved).toBeNull();
  });

  it('uses exact motion for present-mode clip playback instead of original when exact is ready', () => {
    const playbackAssetById: PlaybackAssetRegistry = {
      exact: makeAsset({
        assetId: 'exact',
        assetClass: 'exact_motion',
        readiness: 'ready',
        qualityClass: 'exact',
        safeForPresent: true,
        sourceVideoId: 'video-1',
      }),
      'original:video-1': makeAsset({
        assetId: 'original:video-1',
        assetClass: 'original',
        readiness: 'ready',
        qualityClass: 'exact',
        safeForPresent: true,
        sourceVideoId: 'video-1',
      }),
    };

    const resolved = resolvePlaybackAssetForVideoId({
      videoId: 'video-1',
      workflow: 'present_clip',
      playbackAssetById,
      preferredPlaybackAssetIdByVideoId: {},
      allowFallbackToOriginal: false,
      preferredAssetIds: ['exact'],
    });

    expect(resolved?.assetId).toBe('exact');
  });
});

describe('presentPreparation', () => {
  it('classifies failed exact-motion entries as failed and still builds a retry request', () => {
    const presentation = makePresentation();
    const manifest = makeManifest();
    const clip = makeClip();
    const sourceFingerprint = 'fingerprint-1';
    const generationKey = buildExactClipGenerationKey({
      presentationId: presentation.id,
      sourceFingerprint,
      clipId: clip.id,
      slideId: 'slide-1',
      sourceVideoId: clip.videoId,
      startMs: clip.startMs,
      endMs: clip.endMs,
    });
    const exactMotionIndex: ExactMotionAssetIndexFile = {
      schema: 1,
      entries: [
        {
          assetId: 'exact-failed',
          generationKey,
          motionKind: 'clip_slide',
          transitionOrClipId: clip.id,
          sourceVideoId: clip.videoId,
          sourceFingerprint,
          relativePath: `${generationKey}.mp4`,
          status: 'failed',
          profileVersion: 'exact-v1',
          createdAt: '2026-03-23T00:00:00.000Z',
          error: 'Encoder failed',
        },
      ],
    };

    const requirements = collectPresentClosureRequirements({
      presentation,
      manifest,
      clipById: {
        [clip.id]: clip,
      },
      sourceFingerprintByVideoId: {
        [clip.videoId]: sourceFingerprint,
      },
      exactMotionIndex,
    });
    const evaluation = evaluatePresentClosureRequirements(requirements);
    const request = buildPreparePresentationExactMotionRequest(presentation.id, requirements[0]);
    const statusRecord = buildPresentationPreparationStatusRecord(evaluation, 0);

    expect(requirements[0]?.status).toBe('failed');
    expect(requirements[0]?.failureReason).toBe('Encoder failed');
    expect(evaluation.status).toBe('degraded');
    expect(evaluation.failedRequirements).toHaveLength(1);
    expect(evaluation.invalidRequirements).toHaveLength(0);
    expect(request?.generationKey).toBe(generationKey);
    expect(statusRecord.failedCount).toBe(1);
  });

  it('keeps invalid requirements blocked even when failed assets are retryable', () => {
    const evaluation = evaluatePresentClosureRequirements([
      {
        requirementId: 'invalid-transition',
        kind: 'transition',
        slideIndex: 0,
        transitionOrClipId: 'invalid-transition',
        status: 'invalid',
        failureReason: 'Transition preview is unavailable',
      },
      {
        requirementId: 'failed-clip',
        kind: 'clip_slide',
        slideIndex: 1,
        transitionOrClipId: 'clip-1',
        sourceVideoId: 'video-1',
        sourceFingerprint: 'fingerprint-1',
        generationKey: 'generation-key',
        assetId: 'exact-failed',
        relativePath: 'generation-key.mp4',
        bounds: {
          startMs: 1000,
          endMs: 2000,
        },
        status: 'failed',
        failureReason: 'Encoder failed',
      },
    ]);

    expect(evaluation.status).toBe('failed');
    expect(evaluation.invalidRequirements).toHaveLength(1);
    expect(evaluation.failedRequirements).toHaveLength(1);
  });

  it('surfaces actionable retry guidance for degraded failed generation when no retry is queued', () => {
    const evaluation = evaluatePresentClosureRequirements([
      {
        requirementId: 'failed-clip',
        kind: 'clip_slide',
        slideIndex: 0,
        transitionOrClipId: 'clip-1',
        sourceVideoId: 'video-1',
        sourceFingerprint: 'fingerprint-1',
        generationKey: 'generation-key',
        assetId: 'exact-failed',
        relativePath: 'generation-key.mp4',
        bounds: {
          startMs: 1000,
          endMs: 2000,
        },
        status: 'failed',
        failureReason: 'Encoder failed',
      },
    ]);
    const statusRecord = buildPresentationPreparationStatusRecord(evaluation, 0);

    expect(buildPresentationPreparationSummary({ evaluation, statusRecord })).toBe('0/1 exact ready · 1 failed');
    expect(buildPresentationPreparationStatusLabel({ evaluation, statusRecord })).toBe('Degraded · 0/1 exact ready · 1 failed · Prepare to retry');
  });

  it('does not keep prompting retry when a failed generation retry is already queued', () => {
    const evaluation = evaluatePresentClosureRequirements([
      {
        requirementId: 'failed-clip',
        kind: 'clip_slide',
        slideIndex: 0,
        transitionOrClipId: 'clip-1',
        sourceVideoId: 'video-1',
        sourceFingerprint: 'fingerprint-1',
        generationKey: 'generation-key',
        assetId: 'exact-failed',
        relativePath: 'generation-key.mp4',
        bounds: {
          startMs: 1000,
          endMs: 2000,
        },
        status: 'failed',
        failureReason: 'Encoder failed',
      },
    ]);
    const statusRecord = buildPresentationPreparationStatusRecord(evaluation, 1);

    expect(buildPresentationPreparationSummary({ evaluation, statusRecord })).toBe('0/1 exact ready · 1 queued · 1 failed');
    expect(buildPresentationPreparationStatusLabel({ evaluation, statusRecord })).toBe('Degraded · 0/1 exact ready · 1 queued · 1 failed');
  });
});
