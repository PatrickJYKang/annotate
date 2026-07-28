import type { ClipAnnotation, ClipKeyframe } from '../types/clip';
import type { FrameBoundary, VideoFrame } from './frameMath';

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

function normalizeTrackedKeyframe(keyframe: ClipKeyframe): ClipKeyframe {
  if (keyframe.provenance) return keyframe;
  return {
    ...keyframe,
    provenance: keyframe.visible === false ? 'lost' : 'tracked',
  };
}

export function cloneClipAnnotations(annotations: ClipAnnotation[]): ClipAnnotation[] {
  if (typeof structuredClone === 'function') return structuredClone(annotations);
  return JSON.parse(JSON.stringify(annotations)) as ClipAnnotation[];
}

export function recordClipAnnotationHistoryChange(
  previousAnnotations: ClipAnnotation[],
  nextAnnotations: ClipAnnotation[],
  past: ClipAnnotation[][],
): { past: ClipAnnotation[][]; future: ClipAnnotation[][] } {
  if (nextAnnotations === previousAnnotations) return { past, future: [] };
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
  const previous = params.past[params.past.length - 1];
  if (!previous) {
    return { didUndo: false as const, ...params, annotations: params.currentAnnotations };
  }
  const annotations = cloneClipAnnotations(previous);
  return {
    didUndo: true as const,
    past: params.past.slice(0, -1),
    future: [...params.future, cloneClipAnnotations(params.currentAnnotations)],
    annotations,
    selectedAnnotationId: resolveSelectedAnnotationId(params.selectedAnnotationId, annotations),
  };
}

export function redoClipAnnotationHistory(params: {
  past: ClipAnnotation[][];
  future: ClipAnnotation[][];
  currentAnnotations: ClipAnnotation[];
  selectedAnnotationId: string | null;
}) {
  const next = params.future[params.future.length - 1];
  if (!next) {
    return { didRedo: false as const, ...params, annotations: params.currentAnnotations };
  }
  const annotations = cloneClipAnnotations(next);
  return {
    didRedo: true as const,
    past: [...params.past, cloneClipAnnotations(params.currentAnnotations)],
    future: params.future.slice(0, -1),
    annotations,
    selectedAnnotationId: resolveSelectedAnnotationId(params.selectedAnnotationId, annotations),
  };
}

export function deleteSelectedClipAnnotation(
  annotations: ClipAnnotation[],
  selectedAnnotationId: string | null,
) {
  if (!selectedAnnotationId) return { annotations, selectedAnnotationId };
  return {
    annotations: annotations.filter((annotation) => annotation.id !== selectedAnnotationId),
    selectedAnnotationId: null,
  };
}

export type ClipAnnotationMergeBlocker =
  | 'minimum-selection'
  | 'missing-annotation'
  | 'mixed-type'
  | 'mixed-coordinate-mode'
  | 'overlapping-keyframes';

export type ClipAnnotationMergeInspection =
  | {
      canMerge: true;
      blocker: null;
      selected: ClipAnnotation[];
      survivor: ClipAnnotation;
    }
  | {
      canMerge: false;
      blocker: ClipAnnotationMergeBlocker;
      selected: ClipAnnotation[];
      survivor: null;
    };

export function inspectClipAnnotationMerge(
  annotations: ClipAnnotation[],
  selectedAnnotationIds: readonly string[],
): ClipAnnotationMergeInspection {
  const selected = selectedAnnotationIds.flatMap((annotationId) => {
    const annotation = annotations.find((candidate) => candidate.id === annotationId);
    return annotation ? [annotation] : [];
  });
  if (selectedAnnotationIds.length < 2) {
    return { canMerge: false, blocker: 'minimum-selection', selected, survivor: null };
  }
  if (selected.length !== selectedAnnotationIds.length) {
    return { canMerge: false, blocker: 'missing-annotation', selected, survivor: null };
  }
  const survivor = selected.at(-1)!;
  if (selected.some((annotation) => annotation.type !== survivor.type)) {
    return { canMerge: false, blocker: 'mixed-type', selected, survivor: null };
  }
  if (selected.some((annotation) => annotation.coordMode !== survivor.coordMode)) {
    return { canMerge: false, blocker: 'mixed-coordinate-mode', selected, survivor: null };
  }

  const occupiedFrames = new Set<number>();
  for (const annotation of selected) {
    const frames = [
      ...annotation.keyframes.map((keyframe) => keyframe.frame),
      ...(annotation.visibilityKeyframes ?? []).map((keyframe) => keyframe.frame),
    ];
    for (const frame of frames) {
      if (occupiedFrames.has(frame)) {
        return { canMerge: false, blocker: 'overlapping-keyframes', selected, survivor: null };
      }
      occupiedFrames.add(frame);
    }
  }
  return { canMerge: true, blocker: null, selected, survivor };
}

export function mergeClipAnnotations(
  annotations: ClipAnnotation[],
  selectedAnnotationIds: readonly string[],
): {
  annotations: ClipAnnotation[];
  selectedAnnotationId: string | null;
  didMerge: boolean;
  blocker: ClipAnnotationMergeBlocker | null;
} {
  const inspection = inspectClipAnnotationMerge(annotations, selectedAnnotationIds);
  if (!inspection.canMerge) {
    return {
      annotations,
      selectedAnnotationId: selectedAnnotationIds.at(-1) ?? null,
      didMerge: false,
      blocker: inspection.blocker,
    };
  }

  const survivorId = inspection.survivor.id;
  const mergedIds = new Set(inspection.selected.map((annotation) => annotation.id));
  const removedIds = new Set([...mergedIds].filter((annotationId) => annotationId !== survivorId));
  const keyframes = inspection.selected
    .flatMap((annotation) => annotation.keyframes)
    .sort((left, right) => left.frame - right.frame);
  const visibilityKeyframes = inspection.selected
    .flatMap((annotation) => annotation.visibilityKeyframes ?? [])
    .sort((left, right) => left.frame - right.frame);
  const source = inspection.selected.every(
    (annotation) => annotation.source === inspection.survivor.source,
  )
    ? inspection.survivor.source
    : 'corrected';
  const rewriteReference = (annotationId: string | null | undefined) => (
    annotationId && removedIds.has(annotationId) ? survivorId : annotationId
  );

  const merged: ClipAnnotation = {
    ...inspection.survivor,
    source,
    keyframes,
    visibilityKeyframes: visibilityKeyframes.length > 0 ? visibilityKeyframes : undefined,
  };
  const next = annotations.flatMap((annotation) => {
    if (removedIds.has(annotation.id)) return [];
    const candidate = annotation.id === survivorId ? merged : annotation;
    return [{
      ...candidate,
      trackingAnchorId: rewriteReference(candidate.trackingAnchorId),
      vertexRefs: candidate.vertexRefs?.map((annotationId) => rewriteReference(annotationId) ?? null),
    }];
  });
  return {
    annotations: next,
    selectedAnnotationId: survivorId,
    didMerge: true,
    blocker: null,
  };
}

export function mergeTrackedKeyframesIntoAnnotation(
  annotation: ClipAnnotation,
  newKeyframes: ClipKeyframe[],
  options: {
    mergeMode: 'replace' | 'forward' | 'range' | 'to_correction';
    currentFrame: VideoFrame;
    rangeEndFrame?: VideoFrame;
    clipEndFrame: FrameBoundary;
  },
): ClipAnnotation {
  const normalized = newKeyframes.map(normalizeTrackedKeyframe);
  const { mergeMode, currentFrame, rangeEndFrame, clipEndFrame } = options;
  let merged: ClipKeyframe[];

  if (mergeMode === 'replace') {
    merged = normalized;
  } else if (mergeMode === 'forward') {
    const before = annotation.keyframes.filter((keyframe) => keyframe.frame < currentFrame);
    merged = [...before, ...normalized.filter((keyframe) => keyframe.frame >= currentFrame)];
  } else if (mergeMode === 'to_correction') {
    const boundary = rangeEndFrame ?? clipEndFrame;
    const start = Math.min(currentFrame, boundary);
    const end = Math.max(currentFrame, boundary);
    const before = annotation.keyframes.filter((keyframe) => keyframe.frame < start);
    const after = annotation.keyframes.filter((keyframe) => keyframe.frame >= end);
    const middle = normalized.filter((keyframe) => keyframe.frame >= start && keyframe.frame < end);
    merged = [...before, ...middle, ...after];
  } else {
    const boundary = rangeEndFrame ?? (clipEndFrame - 1);
    const start = Math.min(currentFrame, boundary);
    const end = Math.max(currentFrame, boundary);
    const before = annotation.keyframes.filter((keyframe) => keyframe.frame < start);
    const after = annotation.keyframes.filter((keyframe) => keyframe.frame > end);
    const middle = normalized.filter((keyframe) => keyframe.frame >= start && keyframe.frame <= end);
    merged = [...before, ...middle, ...after];
  }

  merged.sort((left, right) => left.frame - right.frame);
  return {
    ...annotation,
    keyframes: merged,
    source: mergeMode === 'replace' ? 'auto' : 'corrected',
  };
}
