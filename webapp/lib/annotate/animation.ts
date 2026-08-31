import type {
  AnnotationAnimationEffect,
  AnnotationAnimationStep,
} from '../types/annotations';

export interface CompiledAnnotationAnimationStep extends AnnotationAnimationStep {
  clickStep: number;
  startAfterMs: number;
  endAfterMs: number;
}

export interface AnnotationAnimationVisual {
  opacity: number;
  scale: number;
  reveal: number;
}

const HIDDEN_VISUAL: AnnotationAnimationVisual = { opacity: 0, scale: 1, reveal: 0 };
const VISIBLE_VISUAL: AnnotationAnimationVisual = { opacity: 1, scale: 1, reveal: 1 };

export function defaultAnnotationAnimationDuration(effect: AnnotationAnimationEffect): number {
  switch (effect) {
    case 'appear': return 0;
    case 'fade': return 400;
    case 'grow': return 450;
    case 'wipe': return 500;
  }
}

export function compileAnnotationAnimations(
  animations: readonly AnnotationAnimationStep[] | undefined,
): CompiledAnnotationAnimationStep[] {
  let clickStep = 0;
  let previousStartAfterMs = 0;
  let previousEndAfterMs = 0;

  return (animations ?? []).map((animation, index) => {
    let startAfterMs: number;
    if (animation.trigger === 'on_click') {
      clickStep += 1;
      startAfterMs = animation.delayMs;
    } else if (animation.trigger === 'with_previous') {
      startAfterMs = (index === 0 ? 0 : previousStartAfterMs) + animation.delayMs;
    } else {
      startAfterMs = (index === 0 ? 0 : previousEndAfterMs) + animation.delayMs;
    }
    const endAfterMs = startAfterMs + animation.durationMs;
    previousStartAfterMs = startAfterMs;
    previousEndAfterMs = endAfterMs;
    return { ...animation, clickStep, startAfterMs, endAfterMs };
  });
}

export function annotationAnimationClickSteps(
  animations: readonly AnnotationAnimationStep[] | undefined,
): number {
  return compileAnnotationAnimations(animations).reduce(
    (maximum, animation) => Math.max(maximum, animation.clickStep),
    0,
  );
}

export function hasPendingAnnotationAnimationClick(
  animations: readonly AnnotationAnimationStep[] | undefined,
  clickTimesMs: readonly number[],
): boolean {
  return clickTimesMs.length < annotationAnimationClickSteps(animations);
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  const inverse = 1 - clampProgress(value);
  return 1 - inverse * inverse * inverse;
}

function visualFor(effect: AnnotationAnimationEffect, progress: number): AnnotationAnimationVisual {
  const normalized = clampProgress(progress);
  if (normalized <= 0) return HIDDEN_VISUAL;
  if (normalized >= 1) return VISIBLE_VISUAL;
  switch (effect) {
    case 'appear':
      return VISIBLE_VISUAL;
    case 'fade':
      return { opacity: normalized, scale: 1, reveal: 1 };
    case 'grow': {
      const eased = easeOutCubic(normalized);
      return { opacity: normalized, scale: 0.68 + eased * 0.32, reveal: 1 };
    }
    case 'wipe':
      return { opacity: 1, scale: 1, reveal: normalized };
  }
}

export function sampleAnnotationAnimations(
  animations: readonly AnnotationAnimationStep[] | undefined,
  elapsedMs: number,
  clickTimesMs: readonly number[],
): Map<string, AnnotationAnimationVisual> {
  const visuals = new Map<string, AnnotationAnimationVisual>();
  for (const animation of compileAnnotationAnimations(animations)) {
    const activationMs = animation.clickStep === 0
      ? 0
      : clickTimesMs[animation.clickStep - 1];
    let visual = HIDDEN_VISUAL;
    if (activationMs !== undefined) {
      const startedMs = activationMs + animation.startAfterMs;
      const progress = animation.durationMs <= 0
        ? elapsedMs >= startedMs ? 1 : 0
        : (elapsedMs - startedMs) / animation.durationMs;
      visual = visualFor(animation.effect, progress);
    }
    for (const shapeId of animation.shapeIds) visuals.set(shapeId, visual);
  }
  return visuals;
}

export function animationStepForShape(
  animations: readonly AnnotationAnimationStep[] | undefined,
  shapeId: string,
): AnnotationAnimationStep | null {
  return animations?.find((animation) => animation.shapeIds.includes(shapeId)) ?? null;
}
