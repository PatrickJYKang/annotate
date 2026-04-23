"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipAnnotation } from "../../lib/types/clip";
import { getHiddenSpans, getKeyframeProvenance, getManualVisibilitySpans } from "../../lib/clip/trackingState";
import { getFrameDurationMs, snapClipRelativeMsToVideoFrame } from "../../lib/clip/frameMath";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TimelineKeyframeDescriptor {
  key: string;
  annId: string;
  laneIndex: number;
  keyframeIndex: number;
  tMs: number;
  kind: "position" | "visibility";
  action?: "show" | "hide";
}

export interface TimelineStripProps {
  durationMs: number;
  clipStartMs?: number;
  currentTMs: number;
  fps?: number;
  currentFrameToleranceMs?: number;
  annotations: ClipAnnotation[];
  selectedAnnotationId: string | null;
  selectedAnnotationIds?: string[];
  selectedKeyframeKeys?: string[];
  analysisLoopRange?: { startMs: number; endMs: number } | null;
  retrackRangeEndMs?: number | null;
  onSeek: (tMs: number) => void;
  onSelectAnnotation: (id: string | null) => void;
  onSeekToKeyframe: (annId: string, tMs: number) => void;
  onSelectedKeyframeKeysChange?: (keys: string[]) => void;
  onShiftClick?: (tMs: number) => void;
  onMoveKeyframe?: (descriptor: TimelineKeyframeDescriptor, nextTMs: number) => TimelineKeyframeDescriptor | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEADER_H = 20;
const LANE_H = 18;
const DIAMOND_SIZE = 8;
const PLAYHEAD_W = 2;
const RESIZE_HANDLE_H = 8;
const DEFAULT_VISIBLE_LANES = 5;
const MIN_ZOOM_X = 1;
const MAX_ZOOM_X = 12;
const ZOOM_STEP = 1.25;

function getAnnotationAccentColor(annotation: ClipAnnotation): string {
  if (annotation.source === "auto") return "#60a5fa";
  if (annotation.source === "corrected") return "#f59e0b";
  return "#e5e7eb";
}

type KeyframeDescriptor = TimelineKeyframeDescriptor;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TimelineStrip({
  durationMs,
  clipStartMs = 0,
  currentTMs,
  fps = 30,
  currentFrameToleranceMs = 0,
  annotations,
  selectedAnnotationId,
  selectedAnnotationIds = [],
  selectedKeyframeKeys = [],
  analysisLoopRange = null,
  retrackRangeEndMs,
  onSeek,
  onSelectAnnotation,
  onSeekToKeyframe,
  onSelectedKeyframeKeysChange,
  onShiftClick,
  onMoveKeyframe,
}: TimelineStripProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);
  const userResizedRef = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(1);
  const [zoomX, setZoomX] = useState(1);
  const [visibleHeight, setVisibleHeight] = useState(HEADER_H + LANE_H + RESIZE_HANDLE_H + 4);
  const [selectedKeyframeAnchorKey, setSelectedKeyframeAnchorKey] = useState<string | null>(null);
  const suppressClickUntilRef = useRef(0);

  const laneCount = Math.max(annotations.length, 1);
  const lanesHeight = laneCount * LANE_H;
  const minHeight = HEADER_H + LANE_H + RESIZE_HANDLE_H + 4;
  const maxHeight = HEADER_H + lanesHeight + RESIZE_HANDLE_H + 4;
  const defaultHeight = HEADER_H + Math.min(laneCount, DEFAULT_VISIBLE_LANES) * LANE_H + RESIZE_HANDLE_H + 4;
  const timelineBodyHeight = Math.max(0, visibleHeight - HEADER_H - RESIZE_HANDLE_H);
  const contentWidth = Math.max(viewportWidth, Math.round(viewportWidth * zoomX));
  const maxScrollLeft = Math.max(0, contentWidth - viewportWidth);
  const playheadFrac = durationMs > 0 ? currentTMs / durationMs : 0;
  const frameDurationMs = getFrameDurationMs(fps);

  const clampHeight = useCallback((height: number) => {
    return Math.max(minHeight, Math.min(maxHeight, height));
  }, [minHeight, maxHeight]);

  const clampZoom = useCallback((value: number) => {
    return Math.max(MIN_ZOOM_X, Math.min(MAX_ZOOM_X, value));
  }, []);

  useEffect(() => {
    setVisibleHeight((previous) => {
      if (!userResizedRef.current) {
        return defaultHeight;
      }
      return clampHeight(previous);
    });
  }, [clampHeight, defaultHeight]);

  useEffect(() => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) return;
    const update = () => setViewportWidth(Math.max(1, Math.floor(viewportEl.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewportEl);
    return () => observer.disconnect();
  }, []);

  const fracFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
    const viewportEl = viewportRef.current;
    if (!viewportEl || contentWidth <= 0) return 0;
    const rect = viewportEl.getBoundingClientRect();
    const absoluteX = (e.clientX - rect.left) + viewportEl.scrollLeft;
    return Math.max(0, Math.min(1, absoluteX / contentWidth));
  }, [contentWidth]);

  const snapToFrameMs = useCallback((tMs: number) => {
    if (!Number.isFinite(tMs)) return 0;
    return snapClipRelativeMsToVideoFrame(clipStartMs, tMs, fps, durationMs);
  }, [clipStartMs, durationMs, fps]);

  const keyframeDescriptors = useMemo<KeyframeDescriptor[]>(() => (
    annotations
      .flatMap((annotation, laneIndex) => {
        const positionDescriptors = annotation.keyframes.map((keyframe, keyframeIndex) => ({
          key: `geom:${annotation.id}:${keyframeIndex}:${keyframe.tMs}`,
          annId: annotation.id,
          laneIndex,
          keyframeIndex,
          tMs: keyframe.tMs,
          kind: "position" as const,
        }));
        const visibilityDescriptors = (annotation.visibilityKeyframes ?? []).map((keyframe, keyframeIndex) => ({
          key: `vis:${annotation.id}:${keyframeIndex}:${keyframe.tMs}`,
          annId: annotation.id,
          laneIndex,
          keyframeIndex,
          tMs: keyframe.tMs,
          kind: "visibility" as const,
          action: keyframe.action,
        }));
        return [...positionDescriptors, ...visibilityDescriptors];
      })
      .sort((left, right) => (
        left.tMs - right.tMs
        || left.laneIndex - right.laneIndex
        || (left.kind === right.kind ? 0 : left.kind === "position" ? -1 : 1)
        || left.keyframeIndex - right.keyframeIndex
      ))
  ), [annotations]);

  const keyframeOrder = useMemo(() => {
    const order = new Map<string, number>();
    keyframeDescriptors.forEach((descriptor, index) => {
      order.set(descriptor.key, index);
    });
    return order;
  }, [keyframeDescriptors]);

  useEffect(() => {
    const validKeys = new Set(keyframeDescriptors.map((descriptor) => descriptor.key));
    const filtered = selectedKeyframeKeys.filter((key) => validKeys.has(key));
    if (filtered.length !== selectedKeyframeKeys.length) {
      onSelectedKeyframeKeysChange?.(filtered);
    }
    setSelectedKeyframeAnchorKey((previous) => (previous && validKeys.has(previous) ? previous : null));
  }, [keyframeDescriptors, onSelectedKeyframeKeysChange, selectedKeyframeKeys]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (e.shiftKey && onShiftClick) {
      const frac = fracFromEvent(e);
      onShiftClick(snapToFrameMs(frac * durationMs));
      return;
    }

    onSelectedKeyframeKeysChange?.([]);
    setSelectedKeyframeAnchorKey(null);

    const frac = fracFromEvent(e);
    onSeek(snapToFrameMs(frac * durationMs));

    const onMove = (moveEvent: MouseEvent) => {
      const nextFrac = fracFromEvent(moveEvent);
      onSeek(snapToFrameMs(nextFrac * durationMs));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [durationMs, fracFromEvent, onSeek, onSelectedKeyframeKeysChange, onShiftClick, snapToFrameMs]);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    userResizedRef.current = true;
    resizeStartRef.current = { y: e.clientY, height: visibleHeight };

    const onMove = (moveEvent: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      setVisibleHeight(clampHeight(start.height + (moveEvent.clientY - start.y)));
    };

    const onUp = () => {
      resizeStartRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [clampHeight, visibleHeight]);

  const nudgeHorizontalScroll = useCallback((deltaPx: number) => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) return;
    viewportEl.scrollLeft = Math.max(0, Math.min(maxScrollLeft, viewportEl.scrollLeft + deltaPx));
  }, [maxScrollLeft]);

  const onViewportWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) return;

    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const nextZoom = clampZoom(zoomX * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
      if (nextZoom === zoomX) return;

      const rect = viewportEl.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const contentX = viewportEl.scrollLeft + pointerX;
      const focusRatio = contentWidth > 0 ? contentX / contentWidth : 0;
      const nextContentWidth = Math.max(viewportWidth, Math.round(viewportWidth * nextZoom));

      setZoomX(nextZoom);
      requestAnimationFrame(() => {
        const nextLeft = Math.max(0, Math.min(nextContentWidth - viewportWidth, focusRatio * nextContentWidth - pointerX));
        if (viewportRef.current) viewportRef.current.scrollLeft = nextLeft;
      });
      return;
    }

    if (e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      nudgeHorizontalScroll(e.deltaY);
    }
  }, [clampZoom, contentWidth, nudgeHorizontalScroll, viewportWidth, zoomX]);

  const handleZoomOut = useCallback(() => {
    setZoomX((current) => clampZoom(current / ZOOM_STEP));
  }, [clampZoom]);

  const handleZoomIn = useCallback(() => {
    setZoomX((current) => clampZoom(current * ZOOM_STEP));
  }, [clampZoom]);

  const handleZoomReset = useCallback(() => {
    setZoomX(1);
    if (viewportRef.current) viewportRef.current.scrollLeft = 0;
  }, []);

  const handleKeyframeClick = useCallback((event: React.MouseEvent, descriptor: KeyframeDescriptor) => {
    event.stopPropagation();
    if (Date.now() < suppressClickUntilRef.current) return;

    if (event.shiftKey) {
      const anchorKey = selectedKeyframeAnchorKey ?? descriptor.key;
      const anchorIndex = keyframeOrder.get(anchorKey);
      const targetIndex = keyframeOrder.get(descriptor.key);
      if (anchorIndex != null && targetIndex != null) {
        const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        const nextKeys = keyframeDescriptors.slice(start, end + 1).map((entry) => entry.key);
        onSelectedKeyframeKeysChange?.(nextKeys);
        if (!selectedKeyframeAnchorKey) setSelectedKeyframeAnchorKey(descriptor.key);
      } else {
        onSelectedKeyframeKeysChange?.([descriptor.key]);
        setSelectedKeyframeAnchorKey(descriptor.key);
      }
    } else if (event.metaKey || event.ctrlKey) {
      const nextKeys = selectedKeyframeKeys.includes(descriptor.key)
        ? selectedKeyframeKeys.filter((key) => key !== descriptor.key)
        : [...selectedKeyframeKeys, descriptor.key];
      onSelectedKeyframeKeysChange?.(nextKeys);
      setSelectedKeyframeAnchorKey(descriptor.key);
    } else {
      onSelectedKeyframeKeysChange?.([descriptor.key]);
      setSelectedKeyframeAnchorKey(descriptor.key);
    }

    onSeekToKeyframe(descriptor.annId, descriptor.tMs);
  }, [keyframeDescriptors, keyframeOrder, onSeekToKeyframe, onSelectedKeyframeKeysChange, selectedKeyframeAnchorKey, selectedKeyframeKeys]);

  const handleKeyframeMouseDown = useCallback((
    event: React.MouseEvent,
    descriptor: KeyframeDescriptor,
    draggable: boolean,
  ) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (!draggable || event.shiftKey || event.metaKey || event.ctrlKey || !onMoveKeyframe) return;

    let activeDescriptor = descriptor;
    let didDrag = false;
    const startX = event.clientX;
    const initialKey = descriptor.key;

    if (!selectedKeyframeKeys.includes(initialKey)) {
      onSelectedKeyframeKeysChange?.([initialKey]);
      setSelectedKeyframeAnchorKey(initialKey);
    }
    onSeekToKeyframe(descriptor.annId, descriptor.tMs);

    const onMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      if (!didDrag && Math.abs(dx) < 3) return;
      didDrag = true;
      moveEvent.preventDefault();
      const nextFrac = fracFromEvent(moveEvent);
      const nextTMs = snapToFrameMs(nextFrac * durationMs);
      if (Math.abs(nextTMs - activeDescriptor.tMs) < currentFrameToleranceMs) return;
      const moved = onMoveKeyframe(activeDescriptor, nextTMs);
      if (!moved) return;
      activeDescriptor = moved;
      setSelectedKeyframeAnchorKey(moved.key);
      onSeek(moved.tMs);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (didDrag) {
        suppressClickUntilRef.current = Date.now() + 150;
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [
    currentFrameToleranceMs,
    durationMs,
    fracFromEvent,
    onMoveKeyframe,
    onSeek,
    onSeekToKeyframe,
    onSelectedKeyframeKeysChange,
    selectedKeyframeKeys,
    snapToFrameMs,
  ]);

  const ticks = useMemo(() => {
    if (durationMs <= 0) return [] as Array<{ tMs: number; label: string }>;
    const intervals = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000];
    let interval = 1000;
    for (const iv of intervals) {
      const count = durationMs / iv;
      if (count >= 3 && count <= 20) {
        interval = iv;
        break;
      }
    }
    const result: Array<{ tMs: number; label: string }> = [];
    for (let t = 0; t <= durationMs; t += interval) {
      const sec = Math.floor(t / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      const label = m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
      result.push({ tMs: t, label });
    }
    return result;
  }, [durationMs]);

  return (
    <div
      data-testid="clip-timeline"
      className="shrink-0 bg-surface border-t border-border select-none relative overflow-hidden"
      style={{ height: visibleHeight }}
    >
      <div className="absolute top-1 right-2 z-20 flex items-center gap-1 rounded border border-border bg-surface/95 px-1 py-0.5">
        <button
          type="button"
          onClick={handleZoomOut}
          disabled={zoomX <= MIN_ZOOM_X}
          className="px-1.5 py-0 text-xs border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          title="Zoom out horizontally"
        >
          -
        </button>
        <button
          type="button"
          onClick={handleZoomReset}
          disabled={zoomX === 1}
          className="px-1.5 py-0 text-xs border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          title="Reset horizontal zoom"
        >
          {Math.round(zoomX * 100)}%
        </button>
        <button
          type="button"
          onClick={handleZoomIn}
          disabled={zoomX >= MAX_ZOOM_X}
          className="px-1.5 py-0 text-xs border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          title="Zoom in horizontally"
        >
          +
        </button>
      </div>

      <div
        ref={viewportRef}
        className="absolute inset-x-0 top-0 overflow-x-auto overflow-y-hidden cursor-crosshair"
        style={{ bottom: RESIZE_HANDLE_H }}
        onWheel={onViewportWheel}
      >
        <div
          className="relative"
          style={{ width: contentWidth, height: HEADER_H + timelineBodyHeight }}
          onMouseDown={onMouseDown}
        >
          {ticks.map(({ tMs, label }) => {
            const x = durationMs > 0 ? (tMs / durationMs) * 100 : 0;
            return (
              <React.Fragment key={`tick-${tMs}`}>
                <div
                  className="absolute top-0 border-l border-border"
                  style={{ left: `${x}%`, height: HEADER_H }}
                />
                <div
                  className="absolute text-[9px] text-muted pointer-events-none"
                  style={{ left: `${x}%`, top: 2, transform: "translateX(2px)" }}
                >
                  {label}
                </div>
              </React.Fragment>
            );
          })}

          <div
            className="absolute left-0 right-0 border-b border-border"
            style={{ top: HEADER_H }}
          />

          <div
            className="absolute top-0 pointer-events-none"
            style={{
              left: `${playheadFrac * 100}%`,
              width: PLAYHEAD_W,
              height: HEADER_H + timelineBodyHeight,
              backgroundColor: "#fff",
              transform: "translateX(-50%)",
              zIndex: 10,
            }}
          />

          <div
            className="absolute left-0 right-0 overflow-y-auto"
            style={{ top: HEADER_H, height: timelineBodyHeight }}
          >
            <div className="relative" style={{ height: lanesHeight }}>
              {analysisLoopRange && durationMs > 0 && (() => {
                const left = (Math.max(0, Math.min(durationMs, analysisLoopRange.startMs)) / durationMs) * 100;
                const width = (
                  (Math.max(0, Math.min(durationMs, analysisLoopRange.endMs)) - Math.max(0, Math.min(durationMs, analysisLoopRange.startMs)))
                  / durationMs
                ) * 100;
                return (
                  <div
                    className="absolute top-0 pointer-events-none"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      height: lanesHeight,
                      backgroundColor: "rgba(245, 158, 11, 0.12)",
                      borderLeft: "1px solid rgba(245, 158, 11, 0.45)",
                      borderRight: "1px solid rgba(245, 158, 11, 0.45)",
                      zIndex: 4,
                    }}
                  />
                );
              })()}

              {annotations.map((annotation, laneIndex) => {
                const laneTop = laneIndex * LANE_H;
                const isSelected = annotation.id === selectedAnnotationId || selectedAnnotationIds.includes(annotation.id);
                const strokeColor = annotation.style?.stroke || "#000000";
                const accentColor = getAnnotationAccentColor(annotation);
                const hiddenSpans = getHiddenSpans(annotation, durationMs, fps);
                const manualVisibilitySpans = getManualVisibilitySpans(annotation, durationMs);

                return (
                  <div
                    key={annotation.id}
                    className="absolute left-0 right-0"
                    style={{ top: laneTop, height: LANE_H }}
                  >
                    <div
                      className={`absolute inset-0 ${isSelected ? "bg-hover" : ""}`}
                      style={{
                        borderBottom: "1px solid var(--color-border)",
                        boxShadow: isSelected ? `inset 2px 0 0 ${accentColor}` : undefined,
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectedKeyframeKeysChange?.([]);
                        setSelectedKeyframeAnchorKey(null);
                        onSelectAnnotation(annotation.id === selectedAnnotationId ? null : annotation.id);
                      }}
                    />

                    <div
                      className="absolute left-0 top-0 bottom-0"
                      style={{
                        width: 2,
                        backgroundColor: accentColor,
                        opacity: 0.9,
                      }}
                    />

                    <div
                      className={`absolute text-[9px] pointer-events-none truncate ${isSelected ? "text-white" : "text-muted"}`}
                      style={{ left: 2, top: 2, maxWidth: 60 }}
                    >
                      {annotation.type}
                    </div>

                    {hiddenSpans.map((span, spanIndex) => {
                      const isManualVisibilitySpan = manualVisibilitySpans.some((visibilitySpan) => (
                        visibilitySpan.startMs === span.startMs && visibilitySpan.endMs === span.endMs
                      ));
                      const left = durationMs > 0 ? (span.startMs / durationMs) * 100 : 0;
                      const width = durationMs > 0 ? ((span.endMs - span.startMs) / durationMs) * 100 : 0;
                      return (
                        <div
                          key={`${annotation.id}-loss-${spanIndex}`}
                          className="absolute pointer-events-none"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            top: 2,
                            height: LANE_H - 4,
                            backgroundColor: isManualVisibilitySpan
                              ? "rgba(148, 163, 184, 0.18)"
                              : "rgba(248, 113, 113, 0.16)",
                            borderLeft: isManualVisibilitySpan
                              ? "1px solid rgba(148, 163, 184, 0.7)"
                              : "1px solid rgba(248, 113, 113, 0.65)",
                            borderRight: isManualVisibilitySpan
                              ? "1px solid rgba(148, 163, 184, 0.45)"
                              : "1px solid rgba(248, 113, 113, 0.35)",
                          }}
                          title={isManualVisibilitySpan ? "Object hidden in this span" : "Tracker lost object in this span"}
                        />
                      );
                    })}

                    {annotation.keyframes.map((keyframe, keyframeIndex) => {
                      const key = `geom:${annotation.id}:${keyframeIndex}:${keyframe.tMs}`;
                      const x = durationMs > 0 ? (keyframe.tMs / durationMs) * 100 : 0;
                      const isAtCurrentFrame = currentFrameToleranceMs > 0
                        ? Math.abs(keyframe.tMs - currentTMs) <= currentFrameToleranceMs
                        : keyframe.tMs === currentTMs;
                      const provenance = getKeyframeProvenance(annotation, keyframe);
                      const isKeyframeSelected = selectedKeyframeKeys.includes(key);
                      const diamondSize = isAtCurrentFrame ? DIAMOND_SIZE + 3 : DIAMOND_SIZE;
                      const markerColor = provenance === "correction"
                        ? "#f59e0b"
                        : provenance === "tracked"
                          ? "#60a5fa"
                          : provenance === "lost"
                            ? "#f87171"
                            : strokeColor;
                      const canDragKeyframe = provenance === "manual" || provenance === "correction";
                      const isDiamond = provenance === "tracked" || provenance === "manual";
                      const markerHeight = provenance === "lost" ? 4 : diamondSize;
                      const descriptor: KeyframeDescriptor = {
                        key,
                        annId: annotation.id,
                        laneIndex,
                        keyframeIndex,
                        tMs: keyframe.tMs,
                        kind: "position",
                      };
                      return (
                        <div
                          key={`${annotation.id}-kf-${keyframeIndex}`}
                          className={`absolute ${canDragKeyframe ? "cursor-ew-resize" : "cursor-pointer"}`}
                          style={{
                            left: `${x}%`,
                            top: (LANE_H - markerHeight) / 2,
                            width: diamondSize,
                            height: markerHeight,
                            transform: isDiamond ? "translateX(-50%) rotate(45deg)" : "translateX(-50%)",
                            borderRadius: provenance === "correction" ? 2 : provenance === "lost" ? 999 : 0,
                            backgroundColor: markerColor,
                            border: isKeyframeSelected
                              ? "2px solid white"
                              : "1px solid rgba(255,255,255,0.9)",
                            boxShadow: isKeyframeSelected
                              ? "0 0 0 2px rgba(96,165,250,0.55)"
                              : isAtCurrentFrame
                                ? "0 0 0 2px rgba(255,255,255,0.55)"
                                : undefined,
                            zIndex: isKeyframeSelected ? 8 : 6,
                          }}
                          title={`${annotation.type} ${provenance} keyframe @ ${Math.round(keyframe.tMs)}ms${canDragKeyframe ? " (drag to retime)" : ""}`}
                          onMouseDown={(event) => handleKeyframeMouseDown(event, descriptor, canDragKeyframe)}
                          onClick={(event) => handleKeyframeClick(event, descriptor)}
                        />
                      );
                    })}

                    {(annotation.visibilityKeyframes ?? []).map((keyframe, keyframeIndex) => {
                      const key = `vis:${annotation.id}:${keyframeIndex}:${keyframe.tMs}`;
                      const x = durationMs > 0 ? (keyframe.tMs / durationMs) * 100 : 0;
                      const isKeyframeSelected = selectedKeyframeKeys.includes(key);
                      const color = keyframe.action === "show" ? "#22c55e" : "#94a3b8";
                      const descriptor: KeyframeDescriptor = {
                        key,
                        annId: annotation.id,
                        laneIndex,
                        keyframeIndex,
                        tMs: keyframe.tMs,
                        kind: "visibility",
                        action: keyframe.action,
                      };
                      return (
                        <div
                          key={`${annotation.id}-vis-${keyframeIndex}`}
                          className="absolute cursor-ew-resize"
                          style={{
                            left: `${x}%`,
                            top: (LANE_H - 10) / 2,
                            width: 10,
                            height: 10,
                            transform: "translateX(-50%)",
                            borderRadius: 2,
                            backgroundColor: color,
                            border: isKeyframeSelected
                              ? "2px solid white"
                              : "1px solid rgba(255,255,255,0.9)",
                            boxShadow: isKeyframeSelected ? "0 0 0 2px rgba(96,165,250,0.55)" : undefined,
                            zIndex: isKeyframeSelected ? 9 : 7,
                          }}
                          title={`${annotation.type} ${keyframe.action} @ ${Math.round(keyframe.tMs)}ms (drag to retime)`}
                          onMouseDown={(event) => handleKeyframeMouseDown(event, descriptor, true)}
                          onClick={(event) => handleKeyframeClick(event, descriptor)}
                        >
                          <div
                            className="absolute inset-0 flex items-center justify-center text-[8px] leading-none font-semibold text-black"
                            style={{ color: keyframe.action === "show" ? "#052e16" : "#0f172a" }}
                          >
                            {keyframe.action === "show" ? "S" : "H"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {retrackRangeEndMs != null && durationMs > 0 && (() => {
                const startFrac = currentTMs / durationMs;
                const endFrac = retrackRangeEndMs / durationMs;
                const left = Math.min(startFrac, endFrac) * 100;
                const width = Math.abs(endFrac - startFrac) * 100;
                return (
                  <div
                    className="absolute top-0 pointer-events-none"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      height: lanesHeight,
                      backgroundColor: "rgba(59, 130, 246, 0.15)",
                      borderLeft: "1px solid rgba(59, 130, 246, 0.5)",
                      borderRight: "1px solid rgba(59, 130, 246, 0.5)",
                      zIndex: 5,
                    }}
                  />
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      <div
        className="absolute inset-x-0 bottom-0 h-2 cursor-row-resize border-t border-border bg-white/5 hover:bg-white/10"
        onMouseDown={onResizeMouseDown}
      />
    </div>
  );
}
