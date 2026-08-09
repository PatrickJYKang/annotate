"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClipAnnotation, Clip } from '../../lib/types/clip';
import { useLocale, type Translate } from '../../lib/i18n';
import { createTimelineManualOverride } from '../../lib/media/timelineInteraction';
import {
  frameGridStep,
  framePositionX,
  isDeliberateKeyframeDrag,
  timelineXToFrame,
} from '../../lib/clip/timelineGeometry';

export type TimelineKeyframeRef = {
  annotationId: string;
  kind: 'position' | 'visibility';
  index: number;
  frame: number;
};

type TimelineRevealRequest = {
  frame: number;
  id: number;
};

type KeyframeDragState = {
  pointerId: number;
  ref: TimelineKeyframeRef;
  startClientX: number;
  dragging: boolean;
};

interface TimelineStripProps {
  clip: Clip;
  currentFrame: number;
  selectedAnnotationIds: readonly string[];
  selectedPinId?: string | null;
  revealRequest?: TimelineRevealRequest | null;
  selectedKeyframe: TimelineKeyframeRef | null;
  isPlaying: boolean;
  onSkipBack: () => void;
  onPrevious: () => void;
  onTogglePlayback: () => void | Promise<void>;
  onNext: () => void;
  onSkipForward: () => void;
  onSeek: (frame: number) => void;
  onSelectAnnotation: (
    annotationId: string,
    additive?: boolean,
    subtractive?: boolean,
  ) => void;
  onSelectPin?: (pinId: string, frame: number) => void;
  onSelectKeyframe: (keyframe: TimelineKeyframeRef) => void;
  onMoveKeyframe: (keyframe: TimelineKeyframeRef, frame: number) => void;
  variant?: 'editor' | 'pins';
  testIdPrefix?: string;
}

const LABEL_WIDTH = 142;
const ROW_HEIGHT = 32;
const MIN_FRAME_WIDTH = 4;
const MIN_ZOOM = 1;
const MAX_ZOOM = 64;

function clampFrameToClip(clip: Clip, frame: number): number {
  return Math.max(clip.startFrame, Math.min(clip.endFrame - 1, Math.round(frame)));
}

function annotationLabel(annotation: ClipAnnotation, index: number, t: Translate): string {
  const highlightName = annotation.type === 'highlight' ? annotation.name?.trim() : '';
  const label = highlightName || t(`tool.${annotation.type}`);
  return `${index + 1}. ${label}${annotation.coordMode === 'pitch' ? ` · ${t('clip.coordPitch')}` : ''}`;
}

function annotationAccentColor(annotation: ClipAnnotation): string {
  if (annotation.source === 'auto') return '#60a5fa';
  if (annotation.source === 'corrected') return '#f59e0b';
  return '#e5e7eb';
}

interface TimelineAnnotationRowsProps {
  annotations: readonly ClipAnnotation[];
  selectedAnnotationIds: readonly string[];
  selectedKeyframe: TimelineKeyframeRef | null;
  frameToX: (frame: number) => number;
  formatNumber: (value: number) => string;
  t: Translate;
  onKeyframePointerDown: (
    event: React.PointerEvent<HTMLButtonElement>,
    ref: TimelineKeyframeRef,
    draggable: boolean,
  ) => void;
  onKeyframePointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onKeyframePointerEnd: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

function sameTimelineAnnotationRows(
  previous: TimelineAnnotationRowsProps,
  next: TimelineAnnotationRowsProps,
): boolean {
  if (
    previous.selectedKeyframe?.annotationId !== next.selectedKeyframe?.annotationId
    || previous.selectedKeyframe?.kind !== next.selectedKeyframe?.kind
    || previous.selectedKeyframe?.frame !== next.selectedKeyframe?.frame
    || previous.selectedAnnotationIds.length !== next.selectedAnnotationIds.length
    || previous.annotations.length !== next.annotations.length
    || previous.frameToX !== next.frameToX
    || previous.formatNumber !== next.formatNumber
    || previous.t !== next.t
    || previous.onKeyframePointerDown !== next.onKeyframePointerDown
    || previous.onKeyframePointerMove !== next.onKeyframePointerMove
    || previous.onKeyframePointerEnd !== next.onKeyframePointerEnd
  ) {
    return false;
  }
  if (previous.selectedAnnotationIds.some(
    (annotationId, index) => annotationId !== next.selectedAnnotationIds[index],
  )) {
    return false;
  }
  return previous.annotations.every((annotation, index) => {
    const nextAnnotation = next.annotations[index];
    return annotation.id === nextAnnotation.id
      && annotation.type === nextAnnotation.type
      && annotation.keyframes === nextAnnotation.keyframes
      && annotation.visibilityKeyframes === nextAnnotation.visibilityKeyframes;
  });
}

const TimelineAnnotationRows = memo(function TimelineAnnotationRows({
  annotations,
  selectedAnnotationIds,
  selectedKeyframe,
  frameToX,
  formatNumber,
  t,
  onKeyframePointerDown,
  onKeyframePointerMove,
  onKeyframePointerEnd,
}: TimelineAnnotationRowsProps) {
  const selectedAnnotationIdSet = useMemo(
    () => new Set(selectedAnnotationIds),
    [selectedAnnotationIds],
  );

  return annotations.map((annotation, rowIndex) => (
    <div
      key={annotation.id}
      className={`absolute inset-x-0 border-b border-border/70 ${
        selectedAnnotationIdSet.has(annotation.id) ? 'bg-white/[0.04]' : ''
      }`}
      data-timeline-annotation-id={annotation.id}
      style={{ top: 28 + (rowIndex + 1) * ROW_HEIGHT, height: ROW_HEIGHT }}
    >
      {annotation.keyframes.map((keyframe, index) => {
        const ref: TimelineKeyframeRef = {
          annotationId: annotation.id,
          kind: 'position',
          index,
          frame: keyframe.frame,
        };
        const selected = selectedKeyframe?.annotationId === annotation.id
          && selectedKeyframe.kind === 'position'
          && selectedKeyframe.frame === keyframe.frame;
        const draggable = keyframe.provenance !== 'tracked' && keyframe.provenance !== 'lost';
        return (
          <button
            key={`position-${keyframe.frame}`}
            aria-label={t('timeline.keyframeAria', {
              type: t(`tool.${annotation.type}`),
              frame: formatNumber(keyframe.frame),
            })}
            aria-pressed={selected}
            className="absolute top-1/2 h-3.5 w-3.5 rotate-45 border border-white bg-sky-400 p-0"
            style={{
              left: frameToX(keyframe.frame),
              transform: 'translate(-50%, -50%) rotate(45deg)',
              outline: selected ? '2px solid #fff' : undefined,
              cursor: draggable ? 'grab' : 'pointer',
            }}
            title={t('timeline.keyframeTitle', {
              provenance: t(`timeline.provenance.${keyframe.provenance ?? 'manual'}`),
              frame: formatNumber(keyframe.frame),
            })}
            onPointerDown={(event) => onKeyframePointerDown(event, ref, draggable)}
            onPointerMove={onKeyframePointerMove}
            onPointerUp={onKeyframePointerEnd}
            onPointerCancel={onKeyframePointerEnd}
          />
        );
      })}
      {(annotation.visibilityKeyframes ?? []).map((keyframe, index) => {
        const ref: TimelineKeyframeRef = {
          annotationId: annotation.id,
          kind: 'visibility',
          index,
          frame: keyframe.frame,
        };
        const selected = selectedKeyframe?.annotationId === annotation.id
          && selectedKeyframe.kind === 'visibility'
          && selectedKeyframe.frame === keyframe.frame;
        return (
          <button
            key={`visibility-${keyframe.frame}`}
            aria-label={t('timeline.visibilityAria', {
              action: t(`timeline.action.${keyframe.action}`),
              frame: formatNumber(keyframe.frame),
            })}
            aria-pressed={selected}
            className={`absolute top-1/2 h-3 w-3 rounded-full border border-white p-0 ${
              keyframe.action === 'hide' ? 'bg-rose-500' : 'bg-emerald-500'
            }`}
            style={{
              left: frameToX(keyframe.frame),
              transform: 'translate(-50%, -50%)',
              outline: selected ? '2px solid #fff' : undefined,
              cursor: 'grab',
            }}
            title={t('timeline.visibilityTitle', {
              action: t(`timeline.action.${keyframe.action}`),
              frame: formatNumber(keyframe.frame),
            })}
            onPointerDown={(event) => onKeyframePointerDown(event, ref, true)}
            onPointerMove={onKeyframePointerMove}
            onPointerUp={onKeyframePointerEnd}
            onPointerCancel={onKeyframePointerEnd}
          />
        );
      })}
    </div>
  ));
}, sameTimelineAnnotationRows);

export default function TimelineStrip({
  clip,
  currentFrame,
  selectedAnnotationIds,
  selectedPinId = null,
  revealRequest = null,
  selectedKeyframe,
  isPlaying,
  onSkipBack,
  onPrevious,
  onTogglePlayback,
  onNext,
  onSkipForward,
  onSeek,
  onSelectAnnotation,
  onSelectPin,
  onSelectKeyframe,
  onMoveKeyframe,
  variant = 'editor',
  testIdPrefix = 'clip-timeline',
}: TimelineStripProps) {
  const { t, formatNumber } = useLocale();
  const selectedAnnotationIdSet = useMemo(
    () => new Set(selectedAnnotationIds),
    [selectedAnnotationIds],
  );
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const manualOverrideRef = useRef<ReturnType<typeof createTimelineManualOverride> | null>(null);
  const ignoreScrollRef = useRef(false);
  const handledRevealRequestRef = useRef<number | null>(null);
  const keyframeDragRef = useRef<KeyframeDragState | null>(null);
  const onSeekRef = useRef(onSeek);
  const onSelectAnnotationRef = useRef(onSelectAnnotation);
  const onSelectKeyframeRef = useRef(onSelectKeyframe);
  const onMoveKeyframeRef = useRef(onMoveKeyframe);
  onSeekRef.current = onSeek;
  onSelectAnnotationRef.current = onSelectAnnotation;
  onSelectKeyframeRef.current = onSelectKeyframe;
  onMoveKeyframeRef.current = onMoveKeyframe;
  if (!manualOverrideRef.current) manualOverrideRef.current = createTimelineManualOverride();
  const frameCount = clip.endFrame - clip.startFrame;
  const laneWidth = Math.max(640, viewportWidth, frameCount * MIN_FRAME_WIDTH * zoom);
  const frameSpacing = frameCount > 1 ? laneWidth / (frameCount - 1) : laneWidth;
  const gridStep = frameGridStep(frameSpacing);
  const gridSpacing = frameSpacing * gridStep;
  const pinsOnly = variant === 'pins';
  const labelWidth = pinsOnly ? 96 : LABEL_WIDTH;
  const visibleAnnotations = pinsOnly ? [] : clip.annotations;

  const setScrollLeftProgrammatically = useCallback((scroller: HTMLDivElement, scrollLeft: number) => {
    ignoreScrollRef.current = true;
    scroller.scrollLeft = scrollLeft;
    requestAnimationFrame(() => {
      ignoreScrollRef.current = false;
    });
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const updateWidth = () => setViewportWidth(scroller.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setZoom(1);
    handledRevealRequestRef.current = null;
    keyframeDragRef.current = null;
    manualOverrideRef.current = createTimelineManualOverride();
    const scroller = scrollerRef.current;
    if (scroller) setScrollLeftProgrammatically(scroller, 0);
  }, [clip.endFrame, clip.id, clip.startFrame, setScrollLeftProgrammatically]);

  const frameToX = useCallback((frame: number) => {
    return framePositionX(frame, clip.startFrame, clip.endFrame, laneWidth);
  }, [clip.endFrame, clip.startFrame, laneWidth]);

  useEffect(() => {
    if (!revealRequest || handledRevealRequestRef.current === revealRequest.id) return;
    const scroller = scrollerRef.current;
    if (!scroller || viewportWidth <= 0) return;
    handledRevealRequestRef.current = revealRequest.id;
    setScrollLeftProgrammatically(
      scroller,
      Math.max(0, frameToX(revealRequest.frame) - viewportWidth / 2),
    );
  }, [frameToX, revealRequest, setScrollLeftProgrammatically, viewportWidth]);

  const pointerToFrame = useCallback((clientX: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return clip.startFrame;
    const rect = scroller.getBoundingClientRect();
    const contentX = clientX - rect.left + scroller.scrollLeft;
    return timelineXToFrame(contentX, clip.startFrame, clip.endFrame, laneWidth);
  }, [clip.endFrame, clip.startFrame, laneWidth]);

  const handleKeyframePointerDown = useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    ref: TimelineKeyframeRef,
    draggable: boolean,
  ) => {
    event.stopPropagation();
    onSelectAnnotationRef.current(ref.annotationId);
    onSelectKeyframeRef.current(ref);
    onSeekRef.current(ref.frame);
    if (!draggable || event.button !== 0) return;
    keyframeDragRef.current = {
      pointerId: event.pointerId,
      ref,
      startClientX: event.clientX,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleKeyframePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = keyframeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId
      || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (!drag.dragging && !isDeliberateKeyframeDrag(drag.startClientX, event.clientX)) return;
    drag.dragging = true;
    onSeekRef.current(pointerToFrame(event.clientX));
  }, [pointerToFrame]);

  const handleKeyframePointerEnd = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = keyframeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId
      || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (event.type === 'pointerup' && drag.dragging) {
      onMoveKeyframeRef.current(drag.ref, pointerToFrame(event.clientX));
    }
    keyframeDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, [pointerToFrame]);

  useEffect(() => {
    if (!isPlaying || manualOverrideRef.current?.isActive()) return;
    const scroller = scrollerRef.current;
    if (!scroller || viewportWidth <= 0) return;
    const playheadX = frameToX(currentFrame);
    const margin = viewportWidth * 0.33;
    if (
      playheadX < scroller.scrollLeft + margin * 0.5
      || playheadX > scroller.scrollLeft + viewportWidth - margin * 0.5
    ) {
      setScrollLeftProgrammatically(scroller, Math.max(0, playheadX - margin));
    }
  }, [currentFrame, frameToX, isPlaying, setScrollLeftProgrammatically, viewportWidth]);

  const setZoomAroundPoint = useCallback((nextZoom: number, anchorClientX?: number) => {
    const scroller = scrollerRef.current;
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    manualOverrideRef.current?.mark();
    if (!scroller || frameCount <= 1) {
      setZoom(clampedZoom);
      return;
    }
    const rect = scroller.getBoundingClientRect();
    const anchorX = anchorClientX == null ? viewportWidth / 2 : anchorClientX - rect.left;
    const anchorRatio = (scroller.scrollLeft + anchorX) / laneWidth;
    const nextLaneWidth = Math.max(640, viewportWidth, frameCount * MIN_FRAME_WIDTH * clampedZoom);
    setZoom(clampedZoom);
    requestAnimationFrame(() => {
      setScrollLeftProgrammatically(scroller, anchorRatio * nextLaneWidth - anchorX);
    });
  }, [frameCount, laneWidth, setScrollLeftProgrammatically, viewportWidth]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    manualOverrideRef.current?.mark();
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 2 ** -0.1 : 2 ** 0.1;
      setZoomAroundPoint(zoom * factor, event.clientX);
      return;
    }
    if (event.deltaX !== 0) return;
    event.preventDefault();
    scroller.scrollLeft += event.deltaY;
  }, [setZoomAroundPoint, zoom]);

  const handleScroll = useCallback(() => {
    if (!ignoreScrollRef.current) manualOverrideRef.current?.mark();
  }, []);

  const handleLanePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('button')) return;

    event.preventDefault();
    const annotationRow = target.closest<HTMLElement>('[data-timeline-annotation-id]');
    const annotationId = annotationRow?.dataset.timelineAnnotationId;
    if (annotationId) {
      onSelectAnnotation(
        annotationId,
        event.shiftKey,
        event.metaKey || event.ctrlKey,
      );
    }
    onSeek(pointerToFrame(event.clientX));
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [onSeek, onSelectAnnotation, pointerToFrame]);

  const handleLanePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    onSeek(pointerToFrame(event.clientX));
  }, [onSeek, pointerToFrame]);

  const handleLanePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (event.type === 'pointerup') onSeek(pointerToFrame(event.clientX));
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, [onSeek, pointerToFrame]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface" data-testid={testIdPrefix}>
      <div className="flex h-9 items-stretch border-b border-border text-xs">
        <button
          className="button-quiet self-stretch border-0 border-r border-solid border-border px-3"
          onClick={onSkipBack}
          aria-label={t('video.skipBack')}
          title={t('video.skipBack')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 19 2 12 11 5" /><line x1="22" y1="19" x2="22" y2="5" /></svg>
        </button>
        <button
          className="button-quiet self-stretch border-0 border-r border-solid border-border px-3"
          onClick={onPrevious}
          aria-label={t('video.stepBack')}
          title={t('video.stepBackTitle')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <button
          className="button-quiet self-stretch border-0 border-r border-solid border-border px-3"
          onClick={() => void onTogglePlayback()}
          aria-label={isPlaying ? t('video.pause') : t('video.play')}
          title={isPlaying ? t('video.pause') : t('video.play')}
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <button
          className="button-quiet self-stretch border-0 border-r border-solid border-border px-3"
          onClick={onNext}
          aria-label={t('video.stepForward')}
          title={t('video.stepForwardTitle')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
        <button
          className="button-quiet self-stretch border-0 border-r border-solid border-border px-3"
          onClick={onSkipForward}
          aria-label={t('video.skipForward')}
          title={t('video.skipForward')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 19 22 12 13 5" /><line x1="2" y1="19" x2="2" y2="5" /></svg>
        </button>
        <div className="flex min-w-0 items-center gap-3 border-r border-border px-3">
          <strong>{pinsOnly ? t('clip.pins') : t('timeline.keyframes')}</strong>
          <span className="font-mono text-[10px] text-muted">{t('timeline.frameRange', {
            frame: formatNumber(currentFrame),
            start: formatNumber(clip.startFrame),
            end: formatNumber(clip.endFrame - 1),
          })}</span>
        </div>
        <span className="flex-1" />
        <label className="flex items-center gap-2 border-l border-border px-3 text-muted">
          {t('timeline.horizontalZoom')}
          <input
            aria-label={t('timeline.zoom')}
            type="range"
            min={Math.log2(MIN_ZOOM)}
            max={Math.log2(MAX_ZOOM)}
            step={0.1}
            value={Math.log2(zoom)}
            onChange={(event) => setZoomAroundPoint(2 ** Number(event.target.value))}
          />
        </label>
      </div>
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="shrink-0 border-r border-border bg-surface" style={{ width: labelWidth }}>
          <div className="h-7 border-b border-border px-2 py-1 text-[11px] text-muted">{pinsOnly ? '' : t('timeline.objects')}</div>
          <div className="relative border-b border-border py-2 pl-3 pr-2 text-xs font-semibold" style={{ height: ROW_HEIGHT }}>
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-amber-400" />
            {t('clip.pins')}
          </div>
          {visibleAnnotations.map((annotation, index) => (
            <button
              key={annotation.id}
              className={`relative block w-full truncate border-0 border-b border-solid border-border py-0 pl-3 pr-2 text-left text-xs ${
                selectedAnnotationIdSet.has(annotation.id) ? 'bg-white/10 font-semibold' : ''
              }`}
              style={{ height: ROW_HEIGHT }}
              aria-pressed={selectedAnnotationIdSet.has(annotation.id)}
              onClick={(event) => onSelectAnnotation(
                annotation.id,
                event.shiftKey,
                event.metaKey || event.ctrlKey,
              )}
              title={annotation.id}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
                data-testid={`clip-timeline-accent-${annotation.id}`}
                style={{ backgroundColor: annotationAccentColor(annotation) }}
              />
              {annotationLabel(annotation, index, t)}
            </button>
          ))}
        </div>
        <div
          ref={scrollerRef}
          className="min-w-0 flex-1 overflow-x-auto"
          data-testid={`${testIdPrefix}-scroller`}
          onWheel={handleWheel}
          onScroll={handleScroll}
        >
          <div
            className="relative cursor-ew-resize select-none touch-none"
            data-testid={`${testIdPrefix}-lane`}
            data-start-frame={clip.startFrame}
            data-end-frame={clip.endFrame - 1}
            style={{ width: laneWidth, minHeight: 28 + (visibleAnnotations.length + 1) * ROW_HEIGHT }}
            onPointerDown={handleLanePointerDown}
            onPointerMove={handleLanePointerMove}
            onPointerUp={handleLanePointerEnd}
            onPointerCancel={handleLanePointerEnd}
          >
            <div className="absolute inset-x-0 top-0 h-7 border-b border-border bg-black/20">
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const frame = clampFrameToClip(clip, clip.startFrame + ratio * (frameCount - 1));
                return (
                  <span
                    key={ratio}
                    className="absolute top-1 text-[10px] text-muted"
                    style={{ left: frameToX(frame), transform: 'translateX(-50%)' }}
                  >
                    {formatNumber(frame)}
                  </span>
                );
              })}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-7 bottom-0"
              data-testid={testIdPrefix === 'clip-timeline' ? 'clip-frame-grid' : `${testIdPrefix}-frame-grid`}
              data-grid-step={gridStep}
              style={{
                backgroundImage: 'linear-gradient(to right, rgba(148, 163, 184, 0.2) 1px, transparent 1px)',
                backgroundPosition: 'left top',
                backgroundSize: `${gridSpacing}px 100%`,
              }}
            />
            <div
              className="absolute inset-x-0 border-b border-border/70 bg-amber-400/[0.03]"
              style={{ top: 28, height: ROW_HEIGHT }}
            >
              {clip.pins.map((pin) => (
                <button
                  key={pin.id}
                  aria-label={t('timeline.pinAria', { frame: formatNumber(pin.frame) })}
                  className="absolute top-1/2 h-4 w-4 rounded-full border border-white bg-amber-400 p-0"
                  style={{
                    left: frameToX(pin.frame),
                    transform: 'translate(-50%, -50%)',
                    outline: selectedPinId === pin.id ? '2px solid #fff' : undefined,
                  }}
                  title={t('timeline.pinTitle', { label: pin.label || pin.id, frame: formatNumber(pin.frame) })}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectPin?.(pin.id, pin.frame);
                  }}
                />
              ))}
            </div>
            {!pinsOnly && (
              <TimelineAnnotationRows
                annotations={clip.annotations}
                selectedAnnotationIds={selectedAnnotationIds}
                selectedKeyframe={selectedKeyframe}
                frameToX={frameToX}
                formatNumber={formatNumber}
                t={t}
                onKeyframePointerDown={handleKeyframePointerDown}
                onKeyframePointerMove={handleKeyframePointerMove}
                onKeyframePointerEnd={handleKeyframePointerEnd}
              />
            )}
            <div
              className="pointer-events-none absolute left-0 top-0 bottom-0 w-px bg-red-400 will-change-transform"
              style={{ transform: `translateX(${frameToX(currentFrame)}px)` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
