"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { ClipAnnotation } from "../../lib/types/clip";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TimelineStripProps {
  durationMs: number;
  currentTMs: number;
  annotations: ClipAnnotation[];
  selectedAnnotationId: string | null;
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
const MIN_HEIGHT = 40;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TimelineStrip({
  durationMs,
  currentTMs,
  annotations,
  selectedAnnotationId,
  retrackRangeEndMs,
  onSeek,
  onSelectAnnotation,
  onSeekToKeyframe,
  onShiftClick,
}: TimelineStripProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const totalH = Math.max(MIN_HEIGHT, HEADER_H + annotations.length * LANE_H + 4);

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

  const playheadFrac = durationMs > 0 ? currentTMs / durationMs : 0;

  return (
    <div
      ref={containerRef}
      className="shrink-0 bg-surface border-t border-border select-none cursor-crosshair relative overflow-hidden"
      style={{ height: totalH }}
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

      {/* Annotation lanes */}
      {annotations.map((ann, idx) => {
        const laneTop = HEADER_H + idx * LANE_H;
        const isSelected = ann.id === selectedAnnotationId;
        const strokeColor = ann.style?.stroke || '#ff0000';

        return (
          <div
            key={ann.id}
            className="absolute left-0 right-0"
            style={{ top: laneTop, height: LANE_H }}
          >
            {/* Lane background */}
            <div
              className={`absolute inset-0 ${isSelected ? 'bg-hover' : ''}`}
              style={{ borderBottom: '1px solid var(--color-border)' }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectAnnotation(ann.id === selectedAnnotationId ? null : ann.id);
              }}
            />

            {/* Lane label */}
            <div
              className="absolute text-[9px] text-muted pointer-events-none truncate"
              style={{ left: 2, top: 2, maxWidth: 60 }}
            >
              {ann.type}
            </div>

            {/* Keyframe diamonds */}
            {ann.keyframes.map((kf, ki) => {
              const x = durationMs > 0 ? (kf.tMs / durationMs) * 100 : 0;
              return (
                <div
                  key={`${ann.id}-kf-${ki}`}
                  className="absolute cursor-pointer"
                  style={{
                    left: `${x}%`,
                    top: (LANE_H - DIAMOND_SIZE) / 2,
                    width: DIAMOND_SIZE,
                    height: DIAMOND_SIZE,
                    transform: 'translateX(-50%) rotate(45deg)',
                    backgroundColor: strokeColor,
                    border: isSelected ? '1px solid white' : '1px solid rgba(0,0,0,0.3)',
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

      {/* Re-track range overlay */}
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
              height: totalH,
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              borderLeft: '1px solid rgba(59, 130, 246, 0.5)',
              borderRight: '1px solid rgba(59, 130, 246, 0.5)',
              zIndex: 5,
            }}
          />
        );
      })()}

      {/* Playhead */}
      <div
        className="absolute top-0 pointer-events-none"
        style={{
          left: `${playheadFrac * 100}%`,
          width: PLAYHEAD_W,
          height: totalH,
          backgroundColor: '#fff',
          transform: 'translateX(-50%)',
          zIndex: 10,
        }}
      />
    </div>
  );
}
