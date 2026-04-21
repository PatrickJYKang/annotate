import type {
  AnnotationSource,
  ClipAnnotation,
  ClipKeyframe,
  ClipKeyframeProvenance,
} from "../types/clip";

export type ClipFrameTrackingState = "manual" | "tracked" | "correction" | "lost";
export const MAX_INTERPOLATED_TRACK_GAP_MS = 250;
export const MAX_INTERPOLATED_TRACK_GAP_FRAMES = 6;

function fallbackProvenanceFromSource(source: AnnotationSource): ClipKeyframeProvenance {
  if (source === "auto") return "tracked";
  if (source === "corrected") return "tracked";
  return "manual";
}

export function getKeyframeProvenance(
  annotation: Pick<ClipAnnotation, "source">,
  keyframe: Pick<ClipKeyframe, "visible" | "provenance">,
): ClipKeyframeProvenance {
  if (keyframe.provenance) return keyframe.provenance;
  if (keyframe.visible === false) return "lost";
  return fallbackProvenanceFromSource(annotation.source);
}

export function countCorrectionKeyframes(annotation: ClipAnnotation): number {
  return annotation.keyframes.filter((keyframe) => getKeyframeProvenance(annotation, keyframe) === "correction").length;
}

export function getTrackingGapThresholdMs(fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  return Math.min(MAX_INTERPOLATED_TRACK_GAP_MS, (1000 / safeFps) * MAX_INTERPOLATED_TRACK_GAP_FRAMES);
}

export function getLossSpans(annotation: ClipAnnotation, clipDurationMs: number): Array<{ startMs: number; endMs: number }> {
  const spans: Array<{ startMs: number; endMs: number }> = [];
  const keyframes = annotation.keyframes;
  if (keyframes.length === 0) return spans;

  let activeStart: number | null = null;
  for (let index = 0; index < keyframes.length; index += 1) {
    const keyframe = keyframes[index];
    const provenance = getKeyframeProvenance(annotation, keyframe);
    if (provenance === "lost") {
      if (activeStart == null) activeStart = keyframe.tMs;
      continue;
    }
    if (activeStart != null) {
      spans.push({ startMs: activeStart, endMs: keyframe.tMs });
      activeStart = null;
    }
  }

  if (activeStart != null) {
    spans.push({ startMs: activeStart, endMs: clipDurationMs });
  }

  return spans;
}

export function getDerivedHiddenGapSpans(
  annotation: ClipAnnotation,
  fps: number,
): Array<{ startMs: number; endMs: number }> {
  if (annotation.source === "manual") return [];

  const thresholdMs = getTrackingGapThresholdMs(fps);
  const spans: Array<{ startMs: number; endMs: number }> = [];

  for (let index = 0; index < annotation.keyframes.length - 1; index += 1) {
    const left = annotation.keyframes[index];
    const right = annotation.keyframes[index + 1];
    const gapMs = right.tMs - left.tMs;
    if (gapMs <= thresholdMs) continue;

    const leftProv = getKeyframeProvenance(annotation, left);
    const rightProv = getKeyframeProvenance(annotation, right);
    if (leftProv === "lost" || rightProv === "lost") continue;

    const touchesTracking = leftProv !== "manual" || rightProv !== "manual";
    if (!touchesTracking) continue;

    spans.push({ startMs: left.tMs, endMs: right.tMs });
  }

  return spans;
}

function mergeSpans(spans: Array<{ startMs: number; endMs: number }>): Array<{ startMs: number; endMs: number }> {
  if (spans.length <= 1) return spans.slice();
  const sorted = [...spans].sort((left, right) => left.startMs - right.startMs);
  const merged: Array<{ startMs: number; endMs: number }> = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (current.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, current.endMs);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

export function getHiddenSpans(
  annotation: ClipAnnotation,
  clipDurationMs: number,
  fps: number,
): Array<{ startMs: number; endMs: number }> {
  return mergeSpans([
    ...getLossSpans(annotation, clipDurationMs),
    ...getDerivedHiddenGapSpans(annotation, fps),
  ]);
}

export function isTimeWithinHiddenSpan(
  spans: Array<{ startMs: number; endMs: number }>,
  tMs: number,
): boolean {
  return spans.some((span) => tMs > span.startMs && tMs < span.endMs);
}

export function getCurrentKeyframeAtTime(
  annotation: ClipAnnotation,
  currentTMs: number,
  toleranceMs: number,
): ClipKeyframe | null {
  return annotation.keyframes.find((keyframe) => Math.abs(keyframe.tMs - currentTMs) <= toleranceMs) ?? null;
}

export function getNextCorrectionKeyframe(
  annotation: ClipAnnotation,
  currentTMs: number,
  toleranceMs: number,
): ClipKeyframe | null {
  return annotation.keyframes.find((keyframe) => {
    if (keyframe.tMs <= currentTMs + toleranceMs) return false;
    return getKeyframeProvenance(annotation, keyframe) === "correction";
  }) ?? null;
}

export function getFrameTrackingState(
  annotation: ClipAnnotation,
  currentTMs: number,
  toleranceMs: number,
  clipDurationMs: number = annotation.keyframes[annotation.keyframes.length - 1]?.tMs ?? 0,
  fps: number = 30,
): ClipFrameTrackingState {
  const exact = getCurrentKeyframeAtTime(annotation, currentTMs, toleranceMs);
  if (exact) {
    const provenance = getKeyframeProvenance(annotation, exact);
    if (provenance === "lost") return "lost";
    if (provenance === "correction") return "correction";
    if (provenance === "tracked") return "tracked";
    return "manual";
  }

  const keyframes = annotation.keyframes;
  if (keyframes.length === 0) return "manual";
  if (isTimeWithinHiddenSpan(getHiddenSpans(annotation, clipDurationMs, fps), currentTMs)) {
    return "lost";
  }

  if (currentTMs <= keyframes[0].tMs) {
    const provenance = getKeyframeProvenance(annotation, keyframes[0]);
    return provenance === "lost" ? "lost" : provenance === "correction" ? "correction" : provenance === "tracked" ? "tracked" : "manual";
  }

  if (currentTMs >= keyframes[keyframes.length - 1].tMs) {
    const provenance = getKeyframeProvenance(annotation, keyframes[keyframes.length - 1]);
    return provenance === "lost" ? "lost" : provenance === "correction" ? "correction" : provenance === "tracked" ? "tracked" : "manual";
  }

  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const left = keyframes[index];
    const right = keyframes[index + 1];
    if (currentTMs < left.tMs || currentTMs > right.tMs) continue;
    const leftProv = getKeyframeProvenance(annotation, left);
    const rightProv = getKeyframeProvenance(annotation, right);
    if (leftProv === "lost" || rightProv === "lost") return "lost";
    if (leftProv === "correction" || rightProv === "correction") return "correction";
    if (leftProv === "tracked" || rightProv === "tracked") return "tracked";
    return "manual";
  }

  return annotation.source === "manual" ? "manual" : annotation.source === "corrected" ? "correction" : "tracked";
}
