import type { PresentationPlayerState } from './playerController';
import type {
  ExactMotionAssetIndexEntry,
  PlaybackAssetClass,
  PlaybackAssetRegistry,
  PlaybackWorkflow,
  PreferredPlaybackAssetIdByVideoId,
  ResolvedPlaybackAsset,
} from './derivedMediaTypes';
import {
  buildExactClipGenerationKey,
  buildExactTransitionGenerationKey,
} from './derivedMediaKeys';

export type { PlaybackWorkflow, ResolvedPlaybackAsset } from './derivedMediaTypes';

function isUrlLikePath(path: string | null | undefined): boolean {
  return typeof path === 'string' && /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path);
}

export function buildOriginalPlaybackAssetId(videoId: string): string {
  return `original:${videoId}`;
}

export function createOriginalPlaybackAsset(videoId: string, filePath: string, objectUrl?: string | null): ResolvedPlaybackAsset {
  const directObjectUrl = isUrlLikePath(filePath) ? (objectUrl ?? filePath) : (objectUrl ?? null);
  return {
    assetId: buildOriginalPlaybackAssetId(videoId),
    assetClass: 'original',
    readiness: 'ready',
    qualityClass: 'exact',
    safeForPresent: true,
    sourceVideoId: videoId,
    filePath: isUrlLikePath(filePath) ? undefined : filePath,
    objectUrl: directObjectUrl,
    generationKey: buildOriginalPlaybackAssetId(videoId),
  };
}

export function createExactMotionPlaybackAsset(
  entry: ExactMotionAssetIndexEntry,
  presentationId: string,
  objectUrl?: string | null,
): ResolvedPlaybackAsset {
  return {
    assetId: entry.assetId,
    assetClass: 'exact_motion',
    readiness: entry.status,
    qualityClass: 'exact',
    safeForPresent: true,
    sourceVideoId: entry.sourceVideoId,
    filePath: `derived-media/presentations/${presentationId}/${entry.relativePath}`,
    objectUrl,
    durationMs: entry.durationMs,
    sourceFingerprint: entry.sourceFingerprint,
    generationKey: entry.generationKey,
    failureReason: entry.error,
  };
}

export function buildTransitionPlaybackPreferenceKey({
  presentationId,
  slotKey,
  videoId,
  startMs,
  endMs,
}: {
  presentationId: string;
  slotKey: string;
  videoId: string;
  startMs: number;
  endMs?: number | null;
}): string {
  return `transition:${presentationId}:${slotKey}:${videoId}:${startMs}:${endMs ?? 'none'}`;
}

export function buildClipPlaybackPreferenceKey({
  presentationId,
  slideId,
  videoId,
  startMs,
  endMs,
}: {
  presentationId: string;
  slideId: string;
  videoId: string;
  startMs: number;
  endMs: number;
}): string {
  return `clip:${presentationId}:${slideId}:${videoId}:${startMs}:${endMs}`;
}

export function findReadyExactTransitionPlaybackAsset({
  presentationId,
  transitionIndex,
  fromSlideId,
  toSlideId,
  sourceVideoId,
  sourceFingerprint,
  startMs,
  endMs,
  playbackRate,
  startOffsetMs,
  endOffsetMs,
  hideAnnotationsDuringPlayback,
  exactMotionEntries,
}: {
  presentationId: string;
  transitionIndex: number;
  fromSlideId: string;
  toSlideId: string;
  sourceVideoId: string;
  sourceFingerprint: string;
  startMs: number;
  endMs: number;
  playbackRate?: number | null;
  startOffsetMs?: number | null;
  endOffsetMs?: number | null;
  hideAnnotationsDuringPlayback: boolean;
  exactMotionEntries: ExactMotionAssetIndexEntry[];
}): ResolvedPlaybackAsset | null {
  const exactGenerationKey = buildExactTransitionGenerationKey({
    presentationId,
    sourceFingerprint,
    transitionIndex,
    fromSlideId,
    toSlideId,
    sourceVideoId,
    startMs,
    endMs,
    playbackRate: playbackRate ?? null,
    startOffsetMs: startOffsetMs ?? null,
    endOffsetMs: endOffsetMs ?? null,
    hideAnnotationsDuringPlayback,
  });
  const exactEntry = exactMotionEntries.find((entry) => (
    entry.generationKey === exactGenerationKey
    && entry.status === 'ready'
  )) ?? null;
  if (!exactEntry) {
    return null;
  }
  return createExactMotionPlaybackAsset(
    exactEntry,
    presentationId,
    null,
  );
}

export function findReadyExactClipPlaybackAsset({
  presentationId,
  clipId,
  slideId,
  sourceVideoId,
  sourceFingerprint,
  startMs,
  endMs,
  exactMotionEntries,
}: {
  presentationId: string;
  clipId: string;
  slideId: string;
  sourceVideoId: string;
  sourceFingerprint: string;
  startMs: number;
  endMs: number;
  exactMotionEntries: ExactMotionAssetIndexEntry[];
}): ResolvedPlaybackAsset | null {
  const exactGenerationKey = buildExactClipGenerationKey({
    presentationId,
    sourceFingerprint,
    clipId,
    slideId,
    sourceVideoId,
    startMs,
    endMs,
  });
  const exactEntry = exactMotionEntries.find((entry) => (
    entry.generationKey === exactGenerationKey
    && entry.status === 'ready'
  )) ?? null;
  if (!exactEntry) {
    return null;
  }
  return createExactMotionPlaybackAsset(
    exactEntry,
    presentationId,
    null,
  );
}

export function getPlaybackWorkflowForState(state: PresentationPlayerState, isPresenting: boolean): PlaybackWorkflow | null {
  if (state.mode === 'clip') {
    return isPresenting ? 'present_clip' : 'authoring_clip_preview';
  }
  if (state.mode !== 'video') return null;
  if (state.source === 'retrieval') {
    return isPresenting ? 'present_retrieval' : 'authoring_retrieval';
  }
  if (state.source === 'transition') {
    return isPresenting ? 'present_transition' : 'authoring_transition_preview';
  }
  return isPresenting ? 'present_clip' : 'authoring_clip_preview';
}

function getCandidateAssetIds(
  videoId: string,
  preferredPlaybackAssetIdByVideoId: PreferredPlaybackAssetIdByVideoId,
): string[] {
  const preferred = preferredPlaybackAssetIdByVideoId[videoId];
  const original = buildOriginalPlaybackAssetId(videoId);
  if (preferred && preferred !== original) {
    return [preferred, original];
  }
  return [original];
}

const WORKFLOW_ASSET_CLASS_PRIORITY: Record<PlaybackWorkflow, PlaybackAssetClass[]> = {
  authoring_retrieval: ['original'],
  authoring_clip_preview: ['exact_motion'],
  authoring_transition_preview: ['exact_motion'],
  present_transition: ['exact_motion'],
  present_clip: ['exact_motion'],
  present_retrieval: ['original'],
};

export function getPlaybackAssetClassPriority(
  workflow: PlaybackWorkflow,
  allowFallbackToOriginal: boolean,
): PlaybackAssetClass[] {
  const basePriority = WORKFLOW_ASSET_CLASS_PRIORITY[workflow] ?? ['original'];
  if (!allowFallbackToOriginal || basePriority.includes('original')) {
    return basePriority;
  }
  return [...basePriority, 'original'];
}

export function resolvePlaybackAssetForVideoId({
  videoId,
  workflow,
  playbackAssetById,
  preferredPlaybackAssetIdByVideoId,
  allowFallbackToOriginal = true,
  preferredAssetIds = [],
}: {
  videoId: string;
  workflow: PlaybackWorkflow;
  playbackAssetById: PlaybackAssetRegistry;
  preferredPlaybackAssetIdByVideoId: PreferredPlaybackAssetIdByVideoId;
  allowFallbackToOriginal?: boolean;
  preferredAssetIds?: string[];
}): ResolvedPlaybackAsset | null {
  const classPriority = getPlaybackAssetClassPriority(workflow, allowFallbackToOriginal);
  const candidateAssetIds = [
    ...preferredAssetIds,
    ...getCandidateAssetIds(videoId, preferredPlaybackAssetIdByVideoId),
  ];
  const seen = new Set<string>();
  let primaryAsset: ResolvedPlaybackAsset | null = null;

  for (const assetId of candidateAssetIds) {
    if (seen.has(assetId)) continue;
    seen.add(assetId);
    const asset = playbackAssetById[assetId];
    if (!asset) continue;
    if (!primaryAsset) {
      primaryAsset = asset;
    }
    if ((workflow === 'present_transition' || workflow === 'present_clip' || workflow === 'present_retrieval') && !asset.safeForPresent) {
      continue;
    }
    if (asset.readiness !== 'ready') {
      continue;
    }
    if (classPriority.includes(asset.assetClass)) {
      return asset;
    }
  }

  if (
    primaryAsset
    && primaryAsset.readiness === 'ready'
    && (classPriority.includes(primaryAsset.assetClass) || allowFallbackToOriginal)
  ) {
    return primaryAsset;
  }
  return null;
}

type ResolvePlaybackAssetArgs = {
  videoId: string;
  playbackAssetById: PlaybackAssetRegistry;
  preferredPlaybackAssetIdByVideoId: PreferredPlaybackAssetIdByVideoId;
  allowFallbackToOriginal?: boolean;
};

export function resolveAuthoringRetrievalPlaybackAsset(args: ResolvePlaybackAssetArgs): ResolvedPlaybackAsset | null {
  return resolvePlaybackAssetForVideoId({
    ...args,
    workflow: 'authoring_retrieval',
  });
}

export function resolveAuthoringClipPreviewPlaybackAsset(args: ResolvePlaybackAssetArgs): ResolvedPlaybackAsset | null {
  return resolvePlaybackAssetForVideoId({
    ...args,
    workflow: 'authoring_clip_preview',
  });
}

export function resolveAuthoringTransitionPreviewPlaybackAsset(args: ResolvePlaybackAssetArgs): ResolvedPlaybackAsset | null {
  return resolvePlaybackAssetForVideoId({
    ...args,
    workflow: 'authoring_transition_preview',
  });
}

export function resolvePresentTransitionPlaybackAsset(args: ResolvePlaybackAssetArgs): ResolvedPlaybackAsset | null {
  return resolvePlaybackAssetForVideoId({
    ...args,
    workflow: 'present_transition',
  });
}

export function resolvePresentClipPlaybackAsset(args: ResolvePlaybackAssetArgs): ResolvedPlaybackAsset | null {
  return resolvePlaybackAssetForVideoId({
    ...args,
    workflow: 'present_clip',
  });
}
