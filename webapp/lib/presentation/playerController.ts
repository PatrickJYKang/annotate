import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectManifestV1 } from '../types/project';
import type { Clip } from '../types/clip';
import type {
  Presentation,
  PresentationSlide,
  PresentationTransition,
  ClipSlide,
  StillSlide,
  TitleSlide,
} from '../types/presentation';

export type PresentationTransitionPreview = {
  fromSlideIndex: number;
  toSlideIndex: number;
  transition: PresentationTransition;
  playable: boolean;
  reason?: string;
  sourceStartMs?: number;
  sourceEndMs?: number;
  videoId?: string;
  startMs?: number;
  endMs?: number;
  hideAnnotationsDuringPlayback?: boolean;
  playbackRate?: number;
};

export type MatchVideoEdgeValidation = {
  valid: boolean;
  reason?: string;
  fromStill?: ProjectManifestV1['stills'][number];
  toStill?: ProjectManifestV1['stills'][number];
};

export type PresentationPlayerState =
  | {
      mode: 'empty';
      selectedSlideIndex: number;
    }
  | {
      mode: 'missing';
      selectedSlideIndex: number;
      message: string;
    }
  | {
      mode: 'title';
      selectedSlideIndex: number;
      slide: TitleSlide;
    }
  | {
      mode: 'still';
      selectedSlideIndex: number;
      slide: StillSlide;
      still: ProjectManifestV1['stills'][number];
      showAnnotations: boolean;
    }
  | {
      mode: 'clip';
      selectedSlideIndex: number;
      slide: ClipSlide;
      clip: Clip;
    }
  | {
      mode: 'video';
      selectedSlideIndex: number;
      source: 'transition' | 'retrieval' | 'clip';
      videoId: string;
      startMs: number;
      endMs?: number;
      autoplay: boolean;
      hideAnnotationsDuringPlayback: boolean;
      playbackRate?: number;
      transitionToSlideIndex?: number;
      backdropStillId?: string;
      backdropShowAnnotations?: boolean;
      markId?: string;
      label?: string;
    };

function isStillSlide(slide: PresentationSlide | undefined): slide is StillSlide {
  return !!slide && slide.kind === 'still';
}

function isTitleSlide(slide: PresentationSlide | undefined): slide is TitleSlide {
  return !!slide && slide.kind === 'title';
}

function isClipSlide(slide: PresentationSlide | undefined): slide is ClipSlide {
  return !!slide && slide.kind === 'clip';
}

export function validateMatchVideoEdge(
  presentation: Presentation,
  manifest: ProjectManifestV1,
  fromSlideIndex: number,
): MatchVideoEdgeValidation {
  const fromSlide = presentation.slides[fromSlideIndex];
  const toSlide = presentation.slides[fromSlideIndex + 1];
  if (!fromSlide || !toSlide) {
    return {
      valid: false,
      reason: 'No following slide to preview',
    };
  }
  if (!isStillSlide(fromSlide) || !isStillSlide(toSlide)) {
    return {
      valid: false,
      reason: 'match_video requires two still slides',
    };
  }

  const fromStill = manifest.stills.find((still) => still.id === fromSlide.stillId);
  const toStill = manifest.stills.find((still) => still.id === toSlide.stillId);
  if (!fromStill || !toStill) {
    return {
      valid: false,
      reason: 'One or both stills are missing from the project manifest',
    };
  }
  if (fromStill.videoId !== toStill.videoId) {
    return {
      valid: false,
      reason: 'match_video requires adjacent still slides from the same video',
    };
  }
  if (toStill.t_ms <= fromStill.t_ms) {
    return {
      valid: false,
      reason: 'match_video requires forward-only still timestamps',
    };
  }

  return {
    valid: true,
    fromStill,
    toStill,
  };
}

export function resolvePresentationTransitionPreview(
  presentation: Presentation,
  manifest: ProjectManifestV1,
  fromSlideIndex: number,
): PresentationTransitionPreview | null {
  const fromSlide = presentation.slides[fromSlideIndex];
  const toSlide = presentation.slides[fromSlideIndex + 1];
  if (!fromSlide || !toSlide) return null;

  const transition = presentation.transitions[fromSlideIndex] ?? { mode: 'cut' as const };
  if (transition.mode === 'cut') {
    return {
      fromSlideIndex,
      toSlideIndex: fromSlideIndex + 1,
      transition,
      playable: true,
    };
  }

  if (!isStillSlide(fromSlide) || !isStillSlide(toSlide)) {
    return {
      fromSlideIndex,
      toSlideIndex: fromSlideIndex + 1,
      transition,
      playable: false,
      reason: 'match_video requires two still slides',
    };
  }

  const edge = validateMatchVideoEdge(presentation, manifest, fromSlideIndex);
  if (!edge.valid || !edge.fromStill || !edge.toStill) {
    return {
      fromSlideIndex,
      toSlideIndex: fromSlideIndex + 1,
      transition,
      playable: false,
      reason: edge.reason || 'Transition preview is unavailable',
    };
  }

  const fromStill = edge.fromStill;
  const toStill = edge.toStill;
  const startOffsetMs = transition.startOffsetMs ?? 0;
  const endOffsetMs = transition.endOffsetMs ?? 0;
  const playbackRate = transition.playbackRate ?? 1;
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
    return {
      fromSlideIndex,
      toSlideIndex: fromSlideIndex + 1,
      transition,
      playable: false,
      reason: 'Playback rate must be greater than 0',
      sourceStartMs: fromStill.t_ms,
      sourceEndMs: toStill.t_ms,
    };
  }
  if (startOffsetMs < 0) {
    return {
      fromSlideIndex,
      toSlideIndex: fromSlideIndex + 1,
      transition,
      playable: false,
      reason: 'Start trim must be 0ms or greater',
      sourceStartMs: fromStill.t_ms,
      sourceEndMs: toStill.t_ms,
    };
  }
  if (endOffsetMs > 0) {
    return {
      fromSlideIndex,
      toSlideIndex: fromSlideIndex + 1,
      transition,
      playable: false,
      reason: 'End trim must be 0ms or less',
      sourceStartMs: fromStill.t_ms,
      sourceEndMs: toStill.t_ms,
    };
  }

  const startMs = fromStill.t_ms + (transition.startOffsetMs ?? 0);
  const endMs = toStill.t_ms + (transition.endOffsetMs ?? 0);
  if (startMs < fromStill.t_ms || endMs > toStill.t_ms) {
    return {
      fromSlideIndex,
      toSlideIndex: fromSlideIndex + 1,
      transition,
      playable: false,
      reason: 'match_video trims must stay within the source still timestamps',
      sourceStartMs: fromStill.t_ms,
      sourceEndMs: toStill.t_ms,
    };
  }
  if (endMs <= startMs) {
    return {
      fromSlideIndex,
      toSlideIndex: fromSlideIndex + 1,
      transition,
      playable: false,
      reason: 'Transition end must be after the transition start',
      sourceStartMs: fromStill.t_ms,
      sourceEndMs: toStill.t_ms,
    };
  }

  return {
    fromSlideIndex,
    toSlideIndex: fromSlideIndex + 1,
    transition,
    playable: true,
    sourceStartMs: fromStill.t_ms,
    sourceEndMs: toStill.t_ms,
    videoId: fromStill.videoId,
    startMs,
    endMs,
    hideAnnotationsDuringPlayback: transition.hideAnnotationsDuringPlayback,
    playbackRate,
  };
}

function buildSlideState(
  presentation: Presentation,
  manifest: ProjectManifestV1,
  clipById: Record<string, Clip>,
  slideIndex: number,
): PresentationPlayerState {
  const slide = presentation.slides[slideIndex];
  if (!slide) {
    return { mode: 'empty', selectedSlideIndex: -1 };
  }
  if (isTitleSlide(slide)) {
    return {
      mode: 'title',
      selectedSlideIndex: slideIndex,
      slide,
    };
  }
  if (isClipSlide(slide)) {
    const clip = clipById[slide.clipId];
    if (!clip) {
      return {
        mode: 'missing',
        selectedSlideIndex: slideIndex,
        message: `Clip not found for slide ${slide.id}`,
      };
    }
    return {
      mode: 'clip',
      selectedSlideIndex: slideIndex,
      slide,
      clip,
    };
  }
  const still = manifest.stills.find((entry) => entry.id === slide.stillId);
  if (!still) {
    return {
      mode: 'missing',
      selectedSlideIndex: slideIndex,
      message: `Still not found for slide ${slide.id}`,
    };
  }
  return {
    mode: 'still',
    selectedSlideIndex: slideIndex,
    slide,
    still,
    showAnnotations: slide.showAnnotations !== false,
  };
}

export function usePresentationPlayerController(
  presentation: Presentation,
  manifest: ProjectManifestV1,
  clipById: Record<string, Clip> = {},
) {
  const initialSlideIndex = presentation.slides.length > 0 ? 0 : -1;
  const [selectedSlideIndex, setSelectedSlideIndex] = useState(initialSlideIndex);
  const [state, setState] = useState<PresentationPlayerState>(() =>
    initialSlideIndex >= 0
      ? buildSlideState(presentation, manifest, clipById, initialSlideIndex)
      : { mode: 'empty', selectedSlideIndex: -1 },
  );

  useEffect(() => {
    const nextIndex = presentation.slides.length === 0
      ? -1
      : Math.min(Math.max(selectedSlideIndex, 0), presentation.slides.length - 1);
    setSelectedSlideIndex(nextIndex);
    setState(nextIndex >= 0 ? buildSlideState(presentation, manifest, clipById, nextIndex) : { mode: 'empty', selectedSlideIndex: -1 });
  }, [presentation, manifest, clipById, selectedSlideIndex]);

  const currentTransition = useMemo(() => {
    if (selectedSlideIndex < 0) return null;
    return resolvePresentationTransitionPreview(presentation, manifest, selectedSlideIndex);
  }, [presentation, manifest, selectedSlideIndex]);

  const showSlide = useCallback((slideIndex: number) => {
    if (slideIndex < 0 || slideIndex >= presentation.slides.length) {
      setSelectedSlideIndex(-1);
      setState({ mode: 'empty', selectedSlideIndex: -1 });
      return;
    }
    setSelectedSlideIndex(slideIndex);
    setState(buildSlideState(presentation, manifest, clipById, slideIndex));
  }, [presentation, manifest, clipById]);

  const previewTransitionFrom = useCallback((fromSlideIndex: number) => {
    const preview = resolvePresentationTransitionPreview(presentation, manifest, fromSlideIndex);
    const fromSlide = presentation.slides[fromSlideIndex];
    if (!preview) {
      return { ok: false as const, reason: 'No following slide to preview' };
    }
    setSelectedSlideIndex(fromSlideIndex);
    if (preview.transition.mode === 'cut') {
      setState(buildSlideState(presentation, manifest, clipById, preview.toSlideIndex));
      setSelectedSlideIndex(preview.toSlideIndex);
      return { ok: true as const };
    }
    if (!preview.playable || !preview.videoId || preview.startMs == null || preview.endMs == null) {
      setState({
        mode: 'missing',
        selectedSlideIndex: fromSlideIndex,
        message: preview.reason || 'Transition preview is unavailable',
      });
      return { ok: false as const, reason: preview.reason || 'Transition preview is unavailable' };
    }
    if (!isStillSlide(fromSlide)) {
      setState({
        mode: 'missing',
        selectedSlideIndex: fromSlideIndex,
        message: 'Transition preview is unavailable',
      });
      return { ok: false as const, reason: 'Transition preview is unavailable' };
    }
    setState({
      mode: 'video',
      selectedSlideIndex: fromSlideIndex,
      source: 'transition',
      videoId: preview.videoId,
      startMs: preview.startMs,
      endMs: preview.endMs,
      autoplay: true,
      hideAnnotationsDuringPlayback: preview.hideAnnotationsDuringPlayback !== false,
      playbackRate: preview.playbackRate,
      transitionToSlideIndex: preview.toSlideIndex,
      backdropStillId: fromSlide.stillId,
      backdropShowAnnotations: fromSlide.showAnnotations,
      label: 'Transition preview',
    });
    return { ok: true as const };
  }, [presentation, manifest, clipById]);

  const completeVideoPlayback = useCallback(() => {
    setState((current) => {
      if (current.mode !== 'video') return current;
      if (current.source === 'transition' && typeof current.transitionToSlideIndex === 'number') {
        setSelectedSlideIndex(current.transitionToSlideIndex);
        return buildSlideState(presentation, manifest, clipById, current.transitionToSlideIndex);
      }
      return current;
    });
  }, [presentation, manifest, clipById]);

  const stopVideoPlayback = useCallback(() => {
    setState((current) => {
      if (current.mode !== 'video') return current;
      const fallbackIndex = current.selectedSlideIndex;
      if (fallbackIndex >= 0 && fallbackIndex < presentation.slides.length) {
        return buildSlideState(presentation, manifest, clipById, fallbackIndex);
      }
      return { mode: 'empty', selectedSlideIndex: -1 };
    });
  }, [presentation, manifest, clipById]);

  const retrieveMark = useCallback((mark: ProjectManifestV1['marks'][number]) => {
    setState({
      mode: 'video',
      selectedSlideIndex,
      source: 'retrieval',
      videoId: mark.videoId,
      startMs: mark.t_ms,
      autoplay: false,
      hideAnnotationsDuringPlayback: true,
      playbackRate: 1,
      markId: mark.id,
      label: 'Retrieved mark',
    });
  }, [selectedSlideIndex]);

  const goToPreviousSlide = useCallback(() => {
    if (presentation.slides.length === 0) return;
    const nextIndex = selectedSlideIndex <= 0 ? 0 : selectedSlideIndex - 1;
    showSlide(nextIndex);
  }, [presentation.slides.length, selectedSlideIndex, showSlide]);

  const goToNextSlide = useCallback(() => {
    if (presentation.slides.length === 0) return;
    const nextIndex = selectedSlideIndex < 0 ? 0 : Math.min(presentation.slides.length - 1, selectedSlideIndex + 1);
    showSlide(nextIndex);
  }, [presentation.slides.length, selectedSlideIndex, showSlide]);

  return {
    selectedSlideIndex,
    state,
    currentTransition,
    showSlide,
    previewTransitionFrom,
    completeVideoPlayback,
    stopVideoPlayback,
    retrieveMark,
    goToPreviousSlide,
    goToNextSlide,
  };
}
