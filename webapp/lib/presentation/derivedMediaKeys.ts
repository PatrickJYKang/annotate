import {
  DERIVED_MEDIA_GENERATOR_VERSION,
  EXACT_MOTION_PROFILE_VERSION,
} from './derivedMediaConfig';

export interface WeakSourceFingerprintInput {
  projectRelativeVideoPath: string;
  byteSize?: number | null;
  lastModifiedMs?: number | string | null;
}

export interface ExactTransitionGenerationKeyInput {
  presentationId: string;
  sourceFingerprint: string;
  transitionIndex: number;
  fromSlideId: string;
  toSlideId: string;
  sourceVideoId: string;
  startMs: number;
  endMs: number;
  playbackRate?: number | null;
  startOffsetMs?: number | null;
  endOffsetMs?: number | null;
  hideAnnotationsDuringPlayback?: boolean;
  profileVersion?: string;
  generatorVersion?: string;
}

export interface ExactClipGenerationKeyInput {
  presentationId: string;
  sourceFingerprint: string;
  clipId: string;
  slideId: string;
  sourceVideoId: string;
  startMs: number;
  endMs: number;
  profileVersion?: string;
  generatorVersion?: string;
}

function normalizeNumber(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'na';
  return `${Math.round(value)}`;
}

function normalizeString(value?: string | null): string {
  if (!value) return 'na';
  return value.trim();
}

function hashDeterministicString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildStableHash(namespace: string, payload: Record<string, string>): string {
  const body = Object.entries(payload)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('|');
  return `${namespace}:${hashDeterministicString(body)}`;
}

function sanitizeDerivedMediaFileComponent(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function buildWeakSourceFingerprint(input: WeakSourceFingerprintInput): string {
  return buildStableHash('src', {
    path: normalizeString(input.projectRelativeVideoPath),
    size: normalizeNumber(input.byteSize ?? null),
    mtime: typeof input.lastModifiedMs === 'string'
      ? normalizeString(input.lastModifiedMs)
      : normalizeNumber(input.lastModifiedMs ?? null),
  });
}

export function buildExactTransitionGenerationKey(input: ExactTransitionGenerationKeyInput): string {
  return buildStableHash('motion_transition', {
    endMs: normalizeNumber(input.endMs),
    endOffsetMs: normalizeNumber(input.endOffsetMs ?? null),
    fromSlideId: normalizeString(input.fromSlideId),
    generatorVersion: normalizeString(input.generatorVersion ?? DERIVED_MEDIA_GENERATOR_VERSION),
    hideAnnotationsDuringPlayback: input.hideAnnotationsDuringPlayback ? '1' : '0',
    playbackRate: normalizeNumber(input.playbackRate ?? null),
    presentationId: normalizeString(input.presentationId),
    profileVersion: normalizeString(input.profileVersion ?? EXACT_MOTION_PROFILE_VERSION),
    sourceFingerprint: normalizeString(input.sourceFingerprint),
    sourceVideoId: normalizeString(input.sourceVideoId),
    startMs: normalizeNumber(input.startMs),
    startOffsetMs: normalizeNumber(input.startOffsetMs ?? null),
    toSlideId: normalizeString(input.toSlideId),
    transitionIndex: normalizeNumber(input.transitionIndex),
  });
}

export function buildExactClipGenerationKey(input: ExactClipGenerationKeyInput): string {
  return buildStableHash('motion_clip', {
    clipId: normalizeString(input.clipId),
    endMs: normalizeNumber(input.endMs),
    generatorVersion: normalizeString(input.generatorVersion ?? DERIVED_MEDIA_GENERATOR_VERSION),
    presentationId: normalizeString(input.presentationId),
    profileVersion: normalizeString(input.profileVersion ?? EXACT_MOTION_PROFILE_VERSION),
    slideId: normalizeString(input.slideId),
    sourceFingerprint: normalizeString(input.sourceFingerprint),
    sourceVideoId: normalizeString(input.sourceVideoId),
    startMs: normalizeNumber(input.startMs),
  });
}

export function buildExactMotionAssetId(presentationId: string, transitionOrClipId: string, generationKey: string): string {
  return `exact_motion:${presentationId}:${transitionOrClipId}:${generationKey}`;
}

export function buildExactMotionFileName(generationKey: string): string {
  return `motion-${sanitizeDerivedMediaFileComponent(generationKey)}.mp4`;
}

export function buildExactMotionRelativePath(generationKey: string): string {
  return `motion-assets/${buildExactMotionFileName(generationKey)}`;
}
