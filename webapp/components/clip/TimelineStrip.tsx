"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClipAnnotation, Clip } from '../../lib/types/clip';
import { useLocale, type Translate } from '../../lib/i18n';
import { createTimelineManualOverride } from '../../lib/media/timelineInteraction';

export type TimelineKeyframeRef = {
  annotationId: string;
  kind: 'position' | 'visibility';
  index: number;
  frame: number;
};

interface TimelineStripProps {
  clip: Clip;
  currentFrame: number;
  selectedAnnotationId: string | null;
  selectedPinId?: string | null;
  selectedKeyframe: TimelineKeyframeRef | null;
  rangeEndFrame?: number | null;
  isPlaying: boolean;
  onSkipBack: () => void;
  onPrevious: () => void;
  onTogglePlayback: () => void | Promise<void>;
  onNext: () => void;
  onSkipForward: () => void;
  onSeek: (frame: number) => void;
  onSelectAnnotation: (annotationId: string) => void;
  onSelectPin?: (pinId: string, frame: number) => void;
  onSelectKeyframe: (keyframe: TimelineKeyframeRef) => void;
  onMoveKeyframe: (keyframe: TimelineKeyframeRef, frame: number) => void;
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
  return `${index + 1}. ${t(`tool.${annotation.type}`)}${annotation.coordMode === 'pitch' ? ` · ${t('clip.coordPitch')}` : ''}`;
}

function annotationAccentColor(annotation: ClipAnnotation): string {
  if (annotation.source === 'auto') return '#60a5fa';
  if (annotation.source === 'corrected') return '#f59e0b';
  return '#e5e7eb';
}

export default function TimelineStrip({
  clip,
  currentFrame,
  selectedAnnotationId,
  selectedPinId = null,
  selectedKeyframe,
  rangeEndFrame = null,
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
}: TimelineStripProps) {
  const { t, formatNumber } = useLocale();
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const manualOverrideRef = useRef<ReturnType<typeof createTimelineManualOverride> | null>(null);
  const ignoreScrollRef = useRef(false);
  if (!manualOverrideRef.current) manualOverrideRef.current = createTimelineManualOverride();
  const frameCount = clip.endFrame - clip.startFrame;
  const laneWidth = Math.max(640, viewportWidth, frameCount * MIN_FRAME_WIDTH * zoom);

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

  const frameToX = useCallback((frame: number) => {
    if (frameCount <= 1) return 0;
    return ((clampFrameToClip(clip, frame) - clip.startFrame) / (frameCount - 1)) * laneWidth;
  }, [clip, frameCount, laneWidth]);

  const pointerToFrame = useCallback((clientX: number) => {
    const scroller = scrollerRef.current;
    if (!scroller || frameCount <= 1) return clip.startFrame;
    const rect = scroller.getBoundingClientRect();
    const contentX = clientX - rect.left + scroller.scrollLeft;
    return clampFrameToClip(
      clip,
      clip.startFrame + (contentX / laneWidth) * (frameCount - 1),
    );
  }, [clip, frameCount, laneWidth]);

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
    if (annotationId) onSelectAnnotation(annotationId);
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
    <section className="flex h-full min-h-0 flex-col bg-surface" data-testid="clip-timeline">
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
          <strong>{t('timeline.keyframes')}</strong>
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
        <div className="shrink-0 border-r border-border bg-surface" style={{ width: LABEL_WIDTH }}>
          <div className="h-7 border-b border-border px-2 py-1 text-[11px] text-muted">{t('timeline.objects')}</div>
          <div className="relative border-b border-border py-2 pl-3 pr-2 text-xs font-semibold" style={{ height: ROW_HEIGHT }}>
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-amber-400" />
            {t('clip.pins')}
          </div>
          {clip.annotations.map((annotation, index) => (
            <button
              key={annotation.id}
              className={`relative block w-full truncate border-0 border-b border-solid border-border py-0 pl-3 pr-2 text-left text-xs ${
                selectedAnnotationId === annotation.id ? 'bg-white/10 font-semibold' : ''
              }`}
              style={{ height: ROW_HEIGHT }}
              onClick={() => onSelectAnnotation(annotation.id)}
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
          data-testid="clip-timeline-scroller"
          onWheel={handleWheel}
          onScroll={handleScroll}
        >
          <div
            className="relative cursor-ew-resize select-none touch-none"
            data-testid="clip-timeline-lane"
            data-start-frame={clip.startFrame}
            data-end-frame={clip.endFrame - 1}
            style={{ width: laneWidth, minHeight: 28 + (clip.annotations.length + 1) * ROW_HEIGHT }}
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
            {rangeEndFrame != null && (
              <div
                className="pointer-events-none absolute top-7 bottom-0 bg-amber-400/10"
                style={{
                  left: Math.min(frameToX(currentFrame), frameToX(rangeEndFrame)),
                  width: Math.abs(frameToX(rangeEndFrame) - frameToX(currentFrame)),
                }}
              />
            )}
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
            {clip.annotations.map((annotation, rowIndex) => (
              <div
                key={annotation.id}
                className={`absolute inset-x-0 border-b border-border/70 ${
                  selectedAnnotationId === annotation.id ? 'bg-white/[0.04]' : ''
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
                      className="absolute top-1/2 h-3.5 w-3.5 rotate-45 border border-white bg-sky-400 p-0"
                      style={{
                        left: frameToX(keyframe.frame),
                        transform: 'translate(-50%, -50%) rotate(45deg)',
                        outline: selected ? '2px solid #fff' : undefined,
                        cursor: draggable ? 'ew-resize' : 'pointer',
                      }}
                      title={t('timeline.keyframeTitle', {
                        provenance: t(`timeline.provenance.${keyframe.provenance ?? 'manual'}`),
                        frame: formatNumber(keyframe.frame),
                      })}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        onSelectAnnotation(annotation.id);
                        onSelectKeyframe(ref);
                        onSeek(keyframe.frame);
                        if (draggable && event.button === 0) event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        if (!draggable || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        onSeek(pointerToFrame(event.clientX));
                      }}
                      onPointerUp={(event) => {
                        if (!draggable || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        onMoveKeyframe(ref, pointerToFrame(event.clientX));
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }}
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
                      className={`absolute top-1/2 h-3 w-3 rounded-full border border-white p-0 ${
                        keyframe.action === 'hide' ? 'bg-rose-500' : 'bg-emerald-500'
                      }`}
                      style={{
                        left: frameToX(keyframe.frame),
                        transform: 'translate(-50%, -50%)',
                        outline: selected ? '2px solid #fff' : undefined,
                        cursor: 'ew-resize',
                      }}
                      title={t('timeline.visibilityTitle', {
                        action: t(`timeline.action.${keyframe.action}`),
                        frame: formatNumber(keyframe.frame),
                      })}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        onSelectAnnotation(annotation.id);
                        onSelectKeyframe(ref);
                        onSeek(keyframe.frame);
                        if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        onSeek(pointerToFrame(event.clientX));
                      }}
                      onPointerUp={(event) => {
                        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        onMoveKeyframe(ref, pointerToFrame(event.clientX));
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }}
                    />
                  );
                })}
              </div>
            ))}
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-red-400"
              style={{ left: frameToX(currentFrame) }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
