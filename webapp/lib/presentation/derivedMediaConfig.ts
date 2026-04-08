export const PREVIEW_PROXY_PROFILE_VERSION = 'preview_proxy.v1.h264_720p_gop0_5_noaudio';
export const EXACT_MOTION_PROFILE_VERSION = 'exact_motion.v1.h264_sourcefps_presentaudio';
export const DERIVED_MEDIA_GENERATOR_VERSION = 'derived_media_generator.v1';

export const LARGE_SOURCE_DURATION_THRESHOLD_MS = 20 * 60 * 1000;
export const LARGE_SOURCE_BYTE_SIZE_THRESHOLD = Math.floor(1.5 * 1024 * 1024 * 1024);
export const LARGE_SOURCE_SESSION_TOUCH_THRESHOLD = 2;
export const LARGE_SOURCE_PRESENTATION_REFERENCE_THRESHOLD = 3;

export const MAX_INTERACTIVE_PREVIEW_PROXY_JOBS = 1;
export const MAX_INTERACTIVE_EXACT_MOTION_JOBS = 1;
export const MAX_INTERACTIVE_DERIVED_MEDIA_JOBS = 2;
export const MAX_PREPARE_PRESENTATION_EXACT_MOTION_JOBS = 2;

export interface PreviewProxyGateDecisionInput {
  durationMs?: number | null;
  byteSize?: number | null;
  sessionTouchCount?: number;
  presentationReferenceCount?: number;
  explicitPreparation?: boolean;
}

export function isLargeSourceForPreviewProxy(input: Pick<PreviewProxyGateDecisionInput, 'durationMs' | 'byteSize'>): boolean {
  const durationMs = input.durationMs ?? null;
  const byteSize = input.byteSize ?? null;
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > LARGE_SOURCE_DURATION_THRESHOLD_MS) {
    return true;
  }
  if (typeof byteSize === 'number' && Number.isFinite(byteSize) && byteSize > LARGE_SOURCE_BYTE_SIZE_THRESHOLD) {
    return true;
  }
  return false;
}

export function shouldGeneratePreviewProxyNow(input: PreviewProxyGateDecisionInput): boolean {
  if (!isLargeSourceForPreviewProxy(input)) {
    return true;
  }
  if (input.explicitPreparation) {
    return true;
  }
  if ((input.sessionTouchCount ?? 0) >= LARGE_SOURCE_SESSION_TOUCH_THRESHOLD) {
    return true;
  }
  if ((input.presentationReferenceCount ?? 0) >= LARGE_SOURCE_PRESENTATION_REFERENCE_THRESHOLD) {
    return true;
  }
  return false;
}
