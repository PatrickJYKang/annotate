import type { Clip } from '../types/clip';
import type { ProjectManifestV1 } from '../types/project';
import type { Presentation } from '../types/presentation';
import type {
  DerivedMediaBounds,
  ExactMotionAssetIndexEntry,
  ExactMotionAssetIndexFile,
  ExactMotionGenerationRequest,
  PresentationPreparationStatusRecord,
} from './derivedMediaTypes';
import { EXACT_MOTION_PROFILE_VERSION } from './derivedMediaConfig';
import {
  buildExactClipGenerationKey,
  buildExactMotionAssetId,
  buildExactMotionRelativePath,
  buildExactTransitionGenerationKey,
} from './derivedMediaKeys';
import { resolvePresentationTransitionPreview } from './playerController';

export type PresentationPreparationStatus = 'ready' | 'degraded' | 'failed';
export type PresentClosureRequirementKind = 'transition' | 'clip_slide';
export type PresentClosureRequirementStatus = 'ready' | 'missing' | 'failed' | 'invalid';

export interface PresentClosureRequirement {
  requirementId: string;
  kind: PresentClosureRequirementKind;
  slideIndex: number;
  transitionOrClipId: string;
  sourceVideoId?: string;
  sourceFingerprint?: string;
  generationKey?: string;
  assetId?: string;
  relativePath?: string;
  bounds?: DerivedMediaBounds;
  status: PresentClosureRequirementStatus;
  failureReason?: string;
}

export interface PresentClosureEvaluation {
  status: PresentationPreparationStatus;
  requirements: PresentClosureRequirement[];
  readyRequirements: PresentClosureRequirement[];
  missingRequirements: PresentClosureRequirement[];
  failedRequirements: PresentClosureRequirement[];
  invalidRequirements: PresentClosureRequirement[];
}

function buildTransitionRequirementId(fromSlideIndex: number, fromSlideId: string, toSlideId: string): string {
  return `transition:${fromSlideIndex}:${fromSlideId}:${toSlideId}`;
}

function getReadyExactMotionEntry(
  exactMotionIndex: ExactMotionAssetIndexFile,
  generationKey: string,
): ExactMotionAssetIndexEntry | null {
  return exactMotionIndex.entries.find((entry) => entry.generationKey === generationKey && entry.status === 'ready') ?? null;
}

function getRetryBlockedExactMotionEntry(
  exactMotionIndex: ExactMotionAssetIndexFile,
  generationKey: string,
): ExactMotionAssetIndexEntry | null {
  return exactMotionIndex.entries.find((entry) => entry.generationKey === generationKey && entry.status === 'failed') ?? null;
}

export function collectPresentClosureVideoIds(
  presentation: Presentation,
  manifest: ProjectManifestV1,
  clipById: Record<string, Clip>,
): string[] {
  const videoIds = new Set<string>();

  for (let slideIndex = 0; slideIndex < presentation.slides.length; slideIndex += 1) {
    const slide = presentation.slides[slideIndex];
    if (slide.kind === 'clip') {
      const clip = clipById[slide.clipId];
      if (clip) {
        videoIds.add(clip.videoId);
      }
      continue;
    }
    const transition = presentation.transitions[slideIndex];
    if (!transition || transition.mode !== 'match_video') {
      continue;
    }
    const preview = resolvePresentationTransitionPreview(presentation, manifest, slideIndex);
    if (preview?.playable && preview.videoId) {
      videoIds.add(preview.videoId);
    }
  }

  return Array.from(videoIds);
}

export function collectPresentClosureRequirements({
  presentation,
  manifest,
  clipById,
  sourceFingerprintByVideoId,
  exactMotionIndex,
}: {
  presentation: Presentation;
  manifest: ProjectManifestV1;
  clipById: Record<string, Clip>;
  sourceFingerprintByVideoId: Record<string, string>;
  exactMotionIndex: ExactMotionAssetIndexFile;
}): PresentClosureRequirement[] {
  const requirements: PresentClosureRequirement[] = [];

  for (let slideIndex = 0; slideIndex < presentation.slides.length; slideIndex += 1) {
    const slide = presentation.slides[slideIndex];
    if (slide.kind === 'clip') {
      const clip = clipById[slide.clipId];
      const requirementId = `clip:${slide.id}:${slide.clipId}`;
      if (!clip) {
        requirements.push({
          requirementId,
          kind: 'clip_slide',
          slideIndex,
          transitionOrClipId: slide.clipId,
          status: 'invalid',
          failureReason: `Clip not found for slide ${slide.id}`,
        });
        continue;
      }
      const sourceFingerprint = sourceFingerprintByVideoId[clip.videoId];
      if (!sourceFingerprint) {
        requirements.push({
          requirementId,
          kind: 'clip_slide',
          slideIndex,
          transitionOrClipId: clip.id,
          sourceVideoId: clip.videoId,
          status: 'invalid',
          failureReason: `Source fingerprint unavailable for clip ${clip.id}`,
        });
        continue;
      }
      const generationKey = buildExactClipGenerationKey({
        presentationId: presentation.id,
        sourceFingerprint,
        clipId: clip.id,
        slideId: slide.id,
        sourceVideoId: clip.videoId,
        startMs: clip.startMs,
        endMs: clip.endMs,
      });
      const readyEntry = getReadyExactMotionEntry(exactMotionIndex, generationKey);
      const failedEntry = readyEntry ? null : getRetryBlockedExactMotionEntry(exactMotionIndex, generationKey);
      const assetId = readyEntry?.assetId ?? buildExactMotionAssetId(presentation.id, clip.id, generationKey);
      requirements.push({
        requirementId,
        kind: 'clip_slide',
        slideIndex,
        transitionOrClipId: clip.id,
        sourceVideoId: clip.videoId,
        sourceFingerprint,
        generationKey,
        assetId,
        relativePath: buildExactMotionRelativePath(generationKey),
        bounds: {
          startMs: clip.startMs,
          endMs: clip.endMs,
        },
        status: readyEntry ? 'ready' : failedEntry ? 'failed' : 'missing',
        failureReason: failedEntry?.error,
      });
      continue;
    }

    const transition = presentation.transitions[slideIndex];
    if (!transition || transition.mode !== 'match_video') {
      continue;
    }
    const preview = resolvePresentationTransitionPreview(presentation, manifest, slideIndex);
    const fromSlide = presentation.slides[slideIndex];
    const toSlide = presentation.slides[slideIndex + 1];
    const requirementId = buildTransitionRequirementId(
      slideIndex,
      fromSlide?.id ?? `slide-${slideIndex}`,
      toSlide?.id ?? `slide-${slideIndex + 1}`,
    );
    if (!preview || !preview.playable || !preview.videoId || preview.startMs == null || preview.endMs == null || !fromSlide || !toSlide) {
      requirements.push({
        requirementId,
        kind: 'transition',
        slideIndex,
        transitionOrClipId: requirementId,
        status: 'invalid',
        failureReason: preview?.reason || 'Transition preview is unavailable',
      });
      continue;
    }
    const sourceFingerprint = sourceFingerprintByVideoId[preview.videoId];
    if (!sourceFingerprint) {
      requirements.push({
        requirementId,
        kind: 'transition',
        slideIndex,
        transitionOrClipId: requirementId,
        sourceVideoId: preview.videoId,
        status: 'invalid',
        failureReason: `Source fingerprint unavailable for transition ${requirementId}`,
      });
      continue;
    }
    const generationKey = buildExactTransitionGenerationKey({
      presentationId: presentation.id,
      sourceFingerprint,
      transitionIndex: slideIndex,
      fromSlideId: fromSlide.id,
      toSlideId: toSlide.id,
      sourceVideoId: preview.videoId,
      startMs: preview.startMs,
      endMs: preview.endMs,
      playbackRate: preview.playbackRate ?? null,
      startOffsetMs: preview.transition.mode === 'match_video' ? preview.transition.startOffsetMs ?? null : null,
      endOffsetMs: preview.transition.mode === 'match_video' ? preview.transition.endOffsetMs ?? null : null,
      hideAnnotationsDuringPlayback: preview.hideAnnotationsDuringPlayback,
    });
    const readyEntry = getReadyExactMotionEntry(exactMotionIndex, generationKey);
    const failedEntry = readyEntry ? null : getRetryBlockedExactMotionEntry(exactMotionIndex, generationKey);
    const assetId = readyEntry?.assetId ?? buildExactMotionAssetId(presentation.id, requirementId, generationKey);
    requirements.push({
      requirementId,
      kind: 'transition',
      slideIndex,
      transitionOrClipId: requirementId,
      sourceVideoId: preview.videoId,
      sourceFingerprint,
      generationKey,
      assetId,
      relativePath: buildExactMotionRelativePath(generationKey),
      bounds: {
        startMs: preview.startMs,
        endMs: preview.endMs,
      },
      status: readyEntry ? 'ready' : failedEntry ? 'failed' : 'missing',
      failureReason: failedEntry?.error,
    });
  }

  return requirements;
}

export function evaluatePresentClosureRequirements(requirements: PresentClosureRequirement[]): PresentClosureEvaluation {
  const readyRequirements = requirements.filter((requirement) => requirement.status === 'ready');
  const missingRequirements = requirements.filter((requirement) => requirement.status === 'missing');
  const failedRequirements = requirements.filter((requirement) => requirement.status === 'failed');
  const invalidRequirements = requirements.filter((requirement) => requirement.status === 'invalid');

  const status: PresentationPreparationStatus = invalidRequirements.length > 0
    ? 'failed'
    : missingRequirements.length > 0 || failedRequirements.length > 0
      ? 'degraded'
      : 'ready';

  return {
    status,
    requirements,
    readyRequirements,
    missingRequirements,
    failedRequirements,
    invalidRequirements,
  };
}

export function buildPreparePresentationExactMotionRequest(
  presentationId: string,
  requirement: PresentClosureRequirement,
): ExactMotionGenerationRequest | null {
  if (
    (requirement.status !== 'missing' && requirement.status !== 'failed')
    || !requirement.generationKey
    || !requirement.sourceFingerprint
    || !requirement.sourceVideoId
    || !requirement.relativePath
    || !requirement.bounds
  ) {
    return null;
  }

  return {
    kind: 'exact_motion_generate',
    generationKey: requirement.generationKey,
    sourceFingerprint: requirement.sourceFingerprint,
    presentationId,
    motionKind: requirement.kind,
    transitionOrClipId: requirement.transitionOrClipId,
    sourceVideoId: requirement.sourceVideoId,
    outputPath: `derived-media/presentations/${presentationId}/${requirement.relativePath}`,
    profileVersion: EXACT_MOTION_PROFILE_VERSION,
    bounds: requirement.bounds,
  };
}

export function buildPresentationPreparationStatusRecord(
  evaluation: PresentClosureEvaluation,
  queuedJobCount: number,
): PresentationPreparationStatusRecord {
  return {
    status: evaluation.status,
    updatedAt: new Date().toISOString(),
    requiredCount: evaluation.requirements.length,
    readyCount: evaluation.readyRequirements.length,
    failedCount: evaluation.failedRequirements.length + evaluation.invalidRequirements.length,
    queuedJobCount,
  };
}

export function buildPresentationPreparationSummary({
  evaluation,
  statusRecord,
}: {
  evaluation: PresentClosureEvaluation | null;
  statusRecord: PresentationPreparationStatusRecord | null;
}): string {
  if (!evaluation && !statusRecord) {
    return 'Preparation status unavailable';
  }
  const requiredCount = statusRecord?.requiredCount ?? evaluation?.requirements.length ?? 0;
  const readyCount = statusRecord?.readyCount ?? evaluation?.readyRequirements.length ?? 0;
  const queuedJobCount = statusRecord?.queuedJobCount ?? 0;
  const failedCount = evaluation?.failedRequirements.length ?? (statusRecord?.status === 'degraded' ? statusRecord.failedCount : 0);
  const blockedCount = evaluation?.invalidRequirements.length ?? (statusRecord?.status === 'failed' ? statusRecord.failedCount : 0);

  let summary = `${readyCount}/${requiredCount} exact ready`;
  if (queuedJobCount > 0) {
    summary += ` · ${queuedJobCount} queued`;
  }
  if (failedCount > 0) {
    summary += ` · ${failedCount} failed`;
  }
  if (blockedCount > 0) {
    summary += ` · ${blockedCount} blocked`;
  }
  return summary;
}

export function buildPresentationPreparationStatusLabel({
  evaluation,
  statusRecord,
}: {
  evaluation: PresentClosureEvaluation | null;
  statusRecord: PresentationPreparationStatusRecord | null;
}): string {
  const status = statusRecord?.status ?? evaluation?.status;
  if (!status) {
    return 'Preparation status unavailable';
  }
  const summary = buildPresentationPreparationSummary({ evaluation, statusRecord });
  const failedCount = evaluation?.failedRequirements.length ?? (statusRecord?.status === 'degraded' ? statusRecord.failedCount : 0);
  if (status === 'ready') {
    return `Prepared · ${summary}`;
  }
  if (status === 'failed') {
    return `Blocked · ${summary}`;
  }
  if (failedCount > 0 && (statusRecord?.queuedJobCount ?? 0) === 0) {
    return `Degraded · ${summary} · Prepare to retry`;
  }
  return `Degraded · ${summary}`;
}
