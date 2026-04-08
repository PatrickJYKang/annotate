import type { Clip } from '../types/clip';
import type { ProjectManifestV1 } from '../types/project';
import type { Presentation } from '../types/presentation';
import {
  PREVIEW_PROXY_PROFILE_VERSION,
  shouldGeneratePreviewProxyNow,
} from './derivedMediaConfig';
import {
  getDerivedMediaQueuedJobByGenerationKey,
  isActiveDerivedMediaJobStatus,
} from './derivedMediaJobs';
import {
  buildPreviewProxyAssetId,
  buildPreviewProxyGenerationKey,
  buildPreviewProxyRelativePath,
} from './derivedMediaKeys';
import { resolvePresentationTransitionPreview } from './playerController';
import type {
  DerivedMediaJobQueueFile,
  PreviewProxyGenerationRequest,
  PreviewProxyIndexFile,
} from './derivedMediaTypes';

export function countPresentationVideoReferences({
  presentation,
  manifest,
  clipById,
  videoId,
}: {
  presentation: Presentation;
  manifest: ProjectManifestV1;
  clipById: Record<string, Clip>;
  videoId: string;
}): number {
  let count = 0;
  for (const slide of presentation.slides) {
    if (slide.kind === 'still') {
      const still = manifest.stills.find((entry) => entry.id === slide.stillId);
      if (still?.videoId === videoId) {
        count += 1;
      }
      continue;
    }
    if (slide.kind === 'clip') {
      const clip = clipById[slide.clipId];
      if (clip?.videoId === videoId) {
        count += 1;
      }
    }
  }
  for (let index = 0; index < presentation.transitions.length; index += 1) {
    const transition = presentation.transitions[index];
    if (!transition || transition.mode !== 'match_video') {
      continue;
    }
    const preview = resolvePresentationTransitionPreview(presentation, manifest, index);
    if (preview?.playable && preview.videoId === videoId) {
      count += 1;
    }
  }
  return count;
}

export type PreviewProxyGenerationPlanReason =
  | 'enqueue'
  | 'already_ready'
  | 'already_active'
  | 'deferred_large_source';

export function buildInteractivePreviewProxyGenerationPlan({
  videoId,
  sourceFingerprint,
  sourceVideoPath,
  previewProxyIndex,
  previewJobQueue,
  byteSize,
  durationMs,
  sessionTouchCount,
  presentationReferenceCount,
}: {
  videoId: string;
  sourceFingerprint: string;
  sourceVideoPath: string;
  previewProxyIndex: PreviewProxyIndexFile;
  previewJobQueue: DerivedMediaJobQueueFile;
  byteSize?: number | null;
  durationMs?: number | null;
  sessionTouchCount?: number;
  presentationReferenceCount?: number;
}): {
  assetId: string;
  generationKey: string;
  reason: PreviewProxyGenerationPlanReason;
  relativePath: string;
  request: PreviewProxyGenerationRequest | null;
} {
  const generationKey = buildPreviewProxyGenerationKey(sourceFingerprint);
  const relativePath = buildPreviewProxyRelativePath(generationKey);
  const assetId = buildPreviewProxyAssetId(videoId, generationKey);
  const existingEntry = previewProxyIndex.entries.find((entry) => (
    entry.generationKey === generationKey
    && entry.sourceVideoId === videoId
  )) ?? null;
  if (existingEntry && (existingEntry.status === 'ready' || existingEntry.status === 'queued' || existingEntry.status === 'running')) {
    return {
      assetId: existingEntry.assetId,
      generationKey,
      reason: 'already_ready',
      relativePath: existingEntry.relativePath,
      request: null,
    };
  }
  const existingJob = getDerivedMediaQueuedJobByGenerationKey(previewJobQueue, generationKey);
  if (existingJob && isActiveDerivedMediaJobStatus(existingJob.snapshot.status)) {
    return {
      assetId: existingEntry?.assetId ?? assetId,
      generationKey,
      reason: 'already_active',
      relativePath: existingEntry?.relativePath ?? relativePath,
      request: null,
    };
  }
  if (!shouldGeneratePreviewProxyNow({
    byteSize,
    durationMs,
    sessionTouchCount,
    presentationReferenceCount,
    explicitPreparation: false,
  })) {
    return {
      assetId: existingEntry?.assetId ?? assetId,
      generationKey,
      reason: 'deferred_large_source',
      relativePath: existingEntry?.relativePath ?? relativePath,
      request: null,
    };
  }
  return {
    assetId: existingEntry?.assetId ?? assetId,
    generationKey,
    reason: 'enqueue',
    relativePath: existingEntry?.relativePath ?? relativePath,
    request: {
      kind: 'preview_proxy_generate',
      generationKey,
      sourceFingerprint,
      sourceVideoId: videoId,
      sourceVideoPath,
      outputPath: `derived-media/preview-proxies/${existingEntry?.relativePath ?? relativePath}`,
      profileVersion: PREVIEW_PROXY_PROFILE_VERSION,
    },
  };
}
