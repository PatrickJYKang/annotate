import type { ClipAnnotation, ClipKeyframe } from "../types/clip";

export function cloneClipAnnotations(annotations: ClipAnnotation[]): ClipAnnotation[] {
  if (typeof structuredClone === "function") {
    return structuredClone(annotations);
  }
  return JSON.parse(JSON.stringify(annotations)) as ClipAnnotation[];
}

export function createDebouncedAsyncScheduler<T>(
  delayMs: number,
  run: (payload: T) => Promise<void> | void,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(payload: T) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run(payload);
      }, delayMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export function recordClipAnnotationHistoryChange(
  previousAnnotations: ClipAnnotation[],
  nextAnnotations: ClipAnnotation[],
  past: ClipAnnotation[][],
): { past: ClipAnnotation[][]; future: ClipAnnotation[][] } {
  if (nextAnnotations === previousAnnotations) {
    return { past, future: [] };
  }
  return {
    past: [...past, cloneClipAnnotations(previousAnnotations)],
    future: [],
  };
}

function resolveSelectedAnnotationId(
  selectedAnnotationId: string | null,
  annotations: ClipAnnotation[],
): string | null {
  if (!selectedAnnotationId) return null;
  return annotations.some((annotation) => annotation.id === selectedAnnotationId)
    ? selectedAnnotationId
    : annotations[0]?.id ?? null;
}

export function undoClipAnnotationHistory(params: {
  past: ClipAnnotation[][];
  future: ClipAnnotation[][];
  currentAnnotations: ClipAnnotation[];
  selectedAnnotationId: string | null;
}) {
  const { past, future, currentAnnotations, selectedAnnotationId } = params;
  const previous = past[past.length - 1];
  if (!previous) {
    return {
      didUndo: false as const,
      past,
      future,
      annotations: currentAnnotations,
      selectedAnnotationId,
    };
  }
  const annotations = cloneClipAnnotations(previous);
  return {
    didUndo: true as const,
    past: past.slice(0, -1),
    future: [...future, cloneClipAnnotations(currentAnnotations)],
    annotations,
    selectedAnnotationId: resolveSelectedAnnotationId(selectedAnnotationId, annotations),
  };
}

export function redoClipAnnotationHistory(params: {
  past: ClipAnnotation[][];
  future: ClipAnnotation[][];
  currentAnnotations: ClipAnnotation[];
  selectedAnnotationId: string | null;
}) {
  const { past, future, currentAnnotations, selectedAnnotationId } = params;
  const next = future[future.length - 1];
  if (!next) {
    return {
      didRedo: false as const,
      past,
      future,
      annotations: currentAnnotations,
      selectedAnnotationId,
    };
  }
  const annotations = cloneClipAnnotations(next);
  return {
    didRedo: true as const,
    past: [...past, cloneClipAnnotations(currentAnnotations)],
    future: future.slice(0, -1),
    annotations,
    selectedAnnotationId: resolveSelectedAnnotationId(selectedAnnotationId, annotations),
  };
}

export function deleteSelectedClipAnnotation(
  annotations: ClipAnnotation[],
  selectedAnnotationId: string | null,
) {
  if (!selectedAnnotationId) {
    return { annotations, selectedAnnotationId };
  }
  return {
    annotations: annotations.filter((annotation) => annotation.id !== selectedAnnotationId),
    selectedAnnotationId: null,
  };
}

export function mergeTrackedKeyframesIntoAnnotation(
  annotation: ClipAnnotation,
  newKeyframes: ClipKeyframe[],
  options: {
    mergeMode: "replace" | "forward" | "range";
    currentTMs: number;
    rangeEndMs?: number;
    clipDurationMs: number;
  },
): ClipAnnotation {
  const { mergeMode, currentTMs, rangeEndMs, clipDurationMs } = options;

  let merged: ClipKeyframe[];
  if (mergeMode === "replace") {
    merged = newKeyframes;
  } else if (mergeMode === "forward") {
    const kept = annotation.keyframes.filter((keyframe) => keyframe.tMs <= currentTMs);
    merged = [...kept, ...newKeyframes.filter((keyframe) => keyframe.tMs > currentTMs)];
  } else {
    const rawRangeEnd = rangeEndMs ?? clipDurationMs;
    const rangeStart = Math.min(currentTMs, rawRangeEnd);
    const rangeEnd = Math.max(currentTMs, rawRangeEnd);
    const before = annotation.keyframes.filter((keyframe) => keyframe.tMs < rangeStart);
    const after = annotation.keyframes.filter((keyframe) => keyframe.tMs > rangeEnd);
    const middle = newKeyframes.filter((keyframe) => keyframe.tMs >= rangeStart && keyframe.tMs <= rangeEnd);
    merged = [...before, ...middle, ...after];
  }

  merged.sort((left, right) => left.tMs - right.tMs);
  return {
    ...annotation,
    keyframes: merged,
    source: mergeMode === "replace" ? "auto" : "corrected",
  };
}
