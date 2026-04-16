"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { ClipAnnotation } from "../../lib/types/clip";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TimelineStripProps {
  durationMs: number;
  currentTMs: number;
  currentFrameToleranceMs?: number;
  annotations: ClipAnnotation[];
  selectedAnnotationId: string | null;
  analysisLoopRange?: { startMs: number; endMs: number } | null;
  retrackRangeEndMs?: number | null;
  onSeek: (tMs: number) => void;
  onSelectAnnotation: (id: string | null) => void;
  onSeekToKeyframe: (annId: string, tMs: number) => void;
  onShiftClick?: (tMs: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEADER_H = 20;       // ruler height
const LANE_H = 18;         // per-annotation lane height
const DIAMOND_SIZE = 8;
const PLAYHEAD_W = 2;
const RESIZE_HANDLE_H = 8;
const DEFAULT_VISIBLE_LANES = 5;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TimelineStrip({
  durationMs,
  currentTMs,
  currentFrameToleranceMs = 0,
  annotations,
  selectedAnnotationId,
  analysisLoopRange = null,
  retrackRangeEndMs,
  onSeek,
  onSelectAnnotation,
  onSeekToKeyframe,
  onShiftClick,
}: TimelineStripProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);
  const userResizedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const laneCount = Math.max(annotations.length, 1);
  const lanesHeight = laneCount * LANE_H;
  const minHeight = HEADER_H + LANE_H + RESIZE_HANDLE_H + 4;
  const maxHeight = HEADER_H + lanesHeight + RESIZE_HANDLE_H + 4;
  const defaultHeight = HEADER_H + Math.min(laneCount, DEFAULT_VISIBLE_LANES) * LANE_H + RESIZE_HANDLE_H + 4;
  const [visibleHeight, setVisibleHeight] = useState(defaultHeight);

  const clampHeight = useCallback((height: number) => {
    return Math.max(minHeight, Math.min(maxHeight, height));
  }, [minHeight, maxHeight]);

  const timelineBodyHeight = Math.max(0, visibleHeight - HEADER_H - RESIZE_HANDLE_H);

  const playheadFrac = durationMs > 0 ? currentTMs / durationMs : 0;

  const syncScrollTop = useCallback((scrollTop: number) => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    if (Math.abs(scrollEl.scrollTop - scrollTop) > 1) {
      scrollEl.scrollTop = scrollTop;
    }
  }, []);

  React.useEffect(() => {
    setVisibleHeight((previous) => {
      if (!userResizedRef.current) {
        return defaultHeight;
      }
      return clampHeight(previous);
    });
  }, [defaultHeight, clampHeight]);

  // --- Fraction from mouse event ---
  const fracFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }, []);

  // --- Mouse handlers for scrubbing ---
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Shift-click sets re-track range endpoint
    if (e.shiftKey && onShiftClick) {
      const frac = fracFromEvent(e);
      onShiftClick(frac * durationMs);
      return;
    }
    setIsDragging(true);
    const frac = fracFromEvent(e);
    onSeek(frac * durationMs);

    const onMove = (me: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
      onSeek(f * durationMs);
    };
    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [durationMs, onSeek, onShiftClick, fracFromEvent]);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    userResizedRef.current = true;
    resizeStartRef.current = { y: e.clientY, height: visibleHeight };

    const onMove = (moveEvent: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const nextHeight = clampHeight(start.height + (moveEvent.clientY - start.y));
      setVisibleHeight(nextHeight);
    };

    const onUp = () => {
      resizeStartRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [clampHeight, visibleHeight]);

  // --- Ruler tick marks ---
  const ticks = useMemo(() => {
    if (durationMs <= 0) return [];
    // Choose tick interval based on duration
    const intervals = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000];
    let interval = 1000;
    for (const iv of intervals) {
      const count = durationMs / iv;
      if (count >= 3 && count <= 20) { interval = iv; break; }
    }
    const result: { tMs: number; label: string }[] = [];
    for (let t = 0; t <= durationMs; t += interval) {
      const sec = Math.floor(t / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      const label = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
      result.push({ tMs: t, label });
    }
    return result;
  }, [durationMs]);

  return (
    <div
      ref={containerRef}
      data-testid="clip-timeline"
      className="shrink-0 bg-surface border-t border-border select-none cursor-crosshair relative overflow-hidden"
      style={{ height: visibleHeight }}
      onMouseDown={onMouseDown}
    >
      {/* Ruler ticks */}
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
              style={{ left: `${x}%`, top: 2, transform: 'translateX(2px)' }}
            >
              {label}
            </div>
          </React.Fragment>
        );
      })}

      {/* Ruler bottom border */}
      <div
        className="absolute left-0 right-0 border-b border-border"
        style={{ top: HEADER_H }}
      />

      <div
        ref={scrollRef}
        className="absolute left-0 right-0 overflow-y-auto"
        style={{ top: HEADER_H, height: timelineBodyHeight }}
        onScroll={(e) => syncScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div className="relative" style={{ height: lanesHeight }}>
          {analysisLoopRange && durationMs > 0 && (() => {
            const left = (Math.max(0, Math.min(durationMs, analysisLoopRange.startMs)) / durationMs) * 100;
            const width = (Math.max(0, Math.min(durationMs, analysisLoopRange.endMs)) - Math.max(0, Math.min(durationMs, analysisLoopRange.startMs))) / durationMs * 100;
            return (
              <div
                className="absolute top-0 pointer-events-none"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  height: lanesHeight,
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  borderLeft: '1px solid rgba(245, 158, 11, 0.45)',
                  borderRight: '1px solid rgba(245, 158, 11, 0.45)',
                  zIndex: 4,
                }}
              />
            );
          })()}

          {/* Annotation lanes */}
          {annotations.map((ann, idx) => {
            const laneTop = idx * LANE_H;
            const isSelected = ann.id === selectedAnnotationId;
            const strokeColor = ann.style?.stroke || '#000000';

            return (
              <div
                key={ann.id}
                className="absolute left-0 right-0"
                style={{ top: laneTop, height: LANE_H }}
              >
                <div
                  className={`absolute inset-0 ${isSelected ? 'bg-hover' : ''}`}
                  style={{
                    borderBottom: '1px solid var(--color-border)',
                    boxShadow: isSelected ? 'inset 2px 0 0 rgba(255,255,255,0.85)' : undefined,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectAnnotation(ann.id === selectedAnnotationId ? null : ann.id);
                  }}
                />

                <div
                  className={`absolute text-[9px] pointer-events-none truncate ${isSelected ? 'text-white' : 'text-muted'}`}
                  style={{ left: 2, top: 2, maxWidth: 60 }}
                >
                  {ann.type}
                </div>

                {ann.keyframes.map((kf, ki) => {
                  const x = durationMs > 0 ? (kf.tMs / durationMs) * 100 : 0;
                  const isAtCurrentFrame = currentFrameToleranceMs > 0
                    ? Math.abs(kf.tMs - currentTMs) <= currentFrameToleranceMs
                    : kf.tMs === currentTMs;
                  const diamondSize = isAtCurrentFrame ? DIAMOND_SIZE + 3 : DIAMOND_SIZE;
                  return (
                    <div
                      key={`${ann.id}-kf-${ki}`}
                      className="absolute cursor-pointer"
                      style={{
                        left: `${x}%`,
                        top: (LANE_H - diamondSize) / 2,
                        width: diamondSize,
                        height: diamondSize,
                        transform: 'translateX(-50%) rotate(45deg)',
                        backgroundColor: strokeColor,
                        border: isSelected ? '1px solid white' : '1px solid rgba(0,0,0,0.3)',
                        boxShadow: isAtCurrentFrame ? '0 0 0 2px rgba(255,255,255,0.55)' : undefined,
                      }}
                      title={`${ann.type} keyframe @ ${Math.round(kf.tMs)}ms`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAnnotation(ann.id);
                        onSeekToKeyframe(ann.id, kf.tMs);
                      }}
                    />
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
                  backgroundColor: 'rgba(59, 130, 246, 0.15)',
                  borderLeft: '1px solid rgba(59, 130, 246, 0.5)',
                  borderRight: '1px solid rgba(59, 130, 246, 0.5)',
                  zIndex: 5,
                }}
              />
            );
          })()}
        </div>
      </div>

      {/* Playhead */}
      <div
        className="absolute top-0 pointer-events-none"
        style={{
          left: `${playheadFrac * 100}%`,
          width: PLAYHEAD_W,
          height: HEADER_H + timelineBodyHeight,
          backgroundColor: '#fff',
          transform: 'translateX(-50%)',
          zIndex: 10,
        }}
      />

      <div
        className="absolute inset-x-0 bottom-0 h-2 cursor-row-resize border-t border-border bg-white/5 hover:bg-white/10"
        onMouseDown={onResizeMouseDown}
      />
    </div>
  );
}
