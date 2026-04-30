"use client";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { TaggingSelection } from "../../lib/tagging/schema";

type Mark = { id: string; t_ms: number; tags?: TaggingSelection | string[]; label?: string };

type Props = {
  src: string | null;
  fps?: number;
  preload?: "none" | "metadata" | "auto";
  onTimeUpdate?: () => void;
  onLoadedMetadata?: () => void;
  onLoadedData?: () => void;
  onError?: (event: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
  hotkeys?: boolean;
  allowFullscreen?: boolean;
  onAddMark?: (t_ms: number) => void;
  onToggleTag?: (digit: string) => void;
  initialTime?: number;
  externalSeekMs?: number | null;
  skipLargeSeconds?: number;
  className?: string;
  style?: React.CSSProperties;
  marks?: Mark[];
  selectedMarkId?: string | null;
  onSelectMark?: (markId: string, t_ms: number) => void;
  showAddMarkButton?: boolean;
  enableMarkHotkey?: boolean;
  locked?: boolean;
  videoHeight?: string;
};

export type VideoPlayerHandle = {
  playPause: () => Promise<void> | void;
  stepFrame: (dir: -1 | 1) => void;
  nudgeSmall: (dir: -1 | 1) => void;
  nudgeLarge: (dir: -1 | 1) => void;
  seekMs: (t_ms: number) => void;
  getCurrentTimeMs: () => number;
  addMark: () => void;
  getVideoElement: () => HTMLVideoElement | null;
};

function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }

function pad3(n: number) { return n.toString().padStart(3, "0"); }
function formatTime(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms || 0));
  let r = clamped;
  const hh = Math.floor(r / 3600000); r %= 3600000;
  const mm = Math.floor(r / 60000); r %= 60000;
  const ss = Math.floor(r / 1000); const mmm = r % 1000;
  return hh > 0 ? `${hh}:${pad2(mm)}:${pad2(ss)}.${pad3(mmm)}` : `${mm}:${pad2(ss)}.${pad3(mmm)}`;
}

function formatTimeNoMs(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms || 0));
  let r = clamped;
  const hh = Math.floor(r / 3600000); r %= 3600000;
  const mm = Math.floor(r / 60000); r %= 60000;
  const ss = Math.floor(r / 1000);
  return hh > 0 ? `${hh}:${pad2(mm)}:${pad2(ss)}` : `${mm}:${pad2(ss)}`;
}

function VideoPlayerUnitInner({ src, fps = 30, preload = "auto", onTimeUpdate, onLoadedMetadata, onLoadedData, onError, hotkeys = true, allowFullscreen = true, onAddMark, onToggleTag, initialTime, externalSeekMs, skipLargeSeconds = 2, className, style, marks = [], selectedMarkId, onSelectMark, showAddMarkButton = true, enableMarkHotkey = true, locked = false, videoHeight }: Props, ref: React.Ref<VideoPlayerHandle>) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const [activeBtn, setActiveBtn] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const [hoverMarkId, setHoverMarkId] = useState<string | null>(null);
  const prevSelectedMarkIdRef = useRef<string | null>(null);

  const activeBtnStyle = (name: string): React.CSSProperties =>
    activeBtn === name
      ? { background: '#2563eb', borderColor: '#60a5fa', boxShadow: '0 0 0 2px rgba(96,165,250,0.25) inset' }
      : {};
  const btnTransition = 'transition-[background-color,border-color,box-shadow] duration-[120ms] ease';

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => {
      setDuration(isFinite(v.duration) ? v.duration : 0);
      if (typeof initialTime === "number" && initialTime > 0) {
        v.currentTime = Math.min(v.duration || Number.MAX_SAFE_INTEGER, initialTime);
      }
      setReady(true);
    };
    const onTime = () => setCurrent(v.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [initialTime, src]);

  useEffect(() => { setReady(false); }, [src]);

  useEffect(() => {
    return () => { if (flashTimer.current) { clearTimeout(flashTimer.current); } };
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && !dragging && !v.paused) setCurrent(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging]);

  // Apply external seek requests from parent
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (externalSeekMs == null) return;
    const t = Math.max(0, Math.min(v.duration || Number.MAX_SAFE_INTEGER, externalSeekMs / 1000));
    v.currentTime = t;
    setCurrent(t);
  }, [externalSeekMs]);

  const durationMs = Math.floor(duration * 1000);

  const togglePlay = useCallback(async () => {
    if (locked) return;
    const v = videoRef.current;
    if (!v) return;
    setActiveBtn('play'); if (flashTimer.current) clearTimeout(flashTimer.current); flashTimer.current = window.setTimeout(() => setActiveBtn(null), 150);
    if (v.paused) await v.play(); else v.pause();
  }, [locked]);

  const step = useCallback((dir: -1 | 1) => {
    if (locked) return;
    const v = videoRef.current;
    if (!v) return;
    const dt = 1 / (fps || 30);
    v.currentTime = Math.max(0, Math.min(v.duration || Number.MAX_SAFE_INTEGER, v.currentTime + dir * dt));
    setCurrent(v.currentTime);
    setActiveBtn(dir < 0 ? 'frame-back' : 'frame-forward'); if (flashTimer.current) clearTimeout(flashTimer.current); flashTimer.current = window.setTimeout(() => setActiveBtn(null), 150);
  }, [fps, locked]);

  const nudge = useCallback((dir: -1 | 1) => {
    if (locked) return;
    const v = videoRef.current;
    if (!v) return;
    const dt = 0.2;
    v.currentTime = Math.max(0, Math.min(v.duration || Number.MAX_SAFE_INTEGER, v.currentTime + dir * dt));
    setCurrent(v.currentTime);
    // Map small nudge highlight to frame buttons so user sees feedback
    setActiveBtn(dir < 0 ? 'frame-back' : 'frame-forward'); if (flashTimer.current) clearTimeout(flashTimer.current); flashTimer.current = window.setTimeout(() => setActiveBtn(null), 150);
  }, [locked]);

  const largeNudge = useCallback((dir: -1 | 1) => {
    if (locked) return;
    const v = videoRef.current;
    if (!v) return;
    const dt = Math.max(0.5, skipLargeSeconds);
    v.currentTime = Math.max(0, Math.min(v.duration || Number.MAX_SAFE_INTEGER, v.currentTime + dir * dt));
    setCurrent(v.currentTime);
    setActiveBtn(dir < 0 ? 'large-back' : 'large-forward'); if (flashTimer.current) clearTimeout(flashTimer.current); flashTimer.current = window.setTimeout(() => setActiveBtn(null), 150);
  }, [skipLargeSeconds, locked]);

  const addMark = useCallback(() => {
    if (locked) return;
    if (!onAddMark) return;
    const t_ms = Math.round((videoRef.current?.currentTime || 0) * 1000);
    onAddMark(t_ms);
    setActiveBtn('mark'); if (flashTimer.current) clearTimeout(flashTimer.current); flashTimer.current = window.setTimeout(() => setActiveBtn(null), 150);
  }, [onAddMark, locked]);

  const toggleFullscreen = useCallback(() => {
    if (!allowFullscreen) return;
    const el: any = wrapperRef.current;
    if (!el) return;
    const doc: any = document;
    const isFs = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    setActiveBtn('fullscreen'); if (flashTimer.current) clearTimeout(flashTimer.current); flashTimer.current = window.setTimeout(() => setActiveBtn(null), 150);
    if (isFs) {
      if (doc.exitFullscreen) doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    } else {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  }, [allowFullscreen]);

  const handleMediaError = useCallback((event: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    setReady(false);
    setPlaying(false);
    onError?.(event);
  }, [onError]);

  // Imperative API for parent
  useImperativeHandle(ref, () => ({
    playPause: togglePlay,
    stepFrame: (dir: -1 | 1) => step(dir),
    nudgeSmall: (dir: -1 | 1) => nudge(dir),
    nudgeLarge: (dir: -1 | 1) => largeNudge(dir),
    seekMs: (t_ms: number) => {
      const v = videoRef.current; if (!v) return;
      const t = Math.max(0, Math.min(v.duration || Number.MAX_SAFE_INTEGER, (t_ms || 0) / 1000));
      v.currentTime = t; setCurrent(t);
    },
    getCurrentTimeMs: () => Math.round((videoRef.current?.currentTime || 0) * 1000),
    addMark: () => { addMark(); },
    getVideoElement: () => videoRef.current,
  }), [togglePlay, step, nudge, largeNudge]);

  const onKeyDownCapture = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hotkeys || locked) return;
    const key = e.key;
    const shift = e.shiftKey;
    if (key === " " || key === "Spacebar" || key === "Space") { e.preventDefault(); togglePlay(); return; }
    if (key === "ArrowUp" || key === "ArrowDown") { e.preventDefault(); return; }
    if (key === "k" || key === "K") { e.preventDefault(); togglePlay(); return; }
    if (key === "j" || key === "J" || key === ",") { e.preventDefault(); shift ? largeNudge(-1) : step(-1); return; }
    if (key === "l" || key === "L" || key === ".") { e.preventDefault(); shift ? largeNudge(1) : step(1); return; }
    if (key === "ArrowLeft") { e.preventDefault(); shift ? largeNudge(-1) : nudge(-1); return; }
    if (key === "ArrowRight") { e.preventDefault(); shift ? largeNudge(1) : nudge(1); return; }
    if ((key === "m" || key === "M") && enableMarkHotkey) { e.preventDefault(); addMark(); return; }
    if (/^[1-9]$/.test(key) && onToggleTag) { e.preventDefault(); onToggleTag(key); return; }
  }, [hotkeys, locked, enableMarkHotkey, togglePlay, step, nudge, largeNudge, addMark, onToggleTag]);

  // --- Timeline state ---
  const [zoom, setZoom] = useState(1);
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [tlScrollLeft, setTlScrollLeft] = useState(0);

  // Observe timeline container width
  useEffect(() => {
    const el = timelineContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Derived timeline values
  const basePps = containerWidth > 0 && duration > 0 ? containerWidth / duration : 1;
  const pps = basePps * zoom;
  const totalTimelineWidth = duration > 0 ? duration * pps : containerWidth;

  // Visible time range for tick calculation
  const visibleStartTime = pps > 0 ? tlScrollLeft / pps : 0;
  const visibleEndTime = pps > 0 ? Math.min(duration, (tlScrollLeft + containerWidth) / pps) : duration;

  // Tick calculation
  const ticks = useMemo(() => {
    const vis = visibleEndTime - visibleStartTime;
    if (vis <= 0 || duration <= 0) return [] as { time: number; major: boolean; label?: string }[];
    let maj: number, min: number;
    if (vis > 30 * 60) { maj = 5 * 60; min = 60; }
    else if (vis > 5 * 60) { maj = 60; min = 15; }
    else if (vis > 60) { maj = 15; min = 5; }
    else if (vis > 15) { maj = 5; min = 1; }
    else { maj = 1; min = 0.25; }
    const result: { time: number; major: boolean; label?: string }[] = [];
    const first = Math.floor(visibleStartTime / min) * min;
    for (let t = first; t <= visibleEndTime + min; t += min) {
      if (t < 0) continue;
      if (t > duration) break;
      const isMajor = Math.abs(t % maj) < 0.001 || Math.abs(t % maj - maj) < 0.001;
      let label: string | undefined;
      if (isMajor) {
        const ts = Math.round(t);
        const h = Math.floor(ts / 3600), m = Math.floor((ts % 3600) / 60), s = ts % 60;
        label = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
      }
      result.push({ time: t, major: isMajor, label });
    }
    return result;
  }, [visibleStartTime, visibleEndTime, duration]);

  // Track scroll position
  const handleTimelineScroll = useCallback(() => {
    const el = timelineContainerRef.current;
    if (el) setTlScrollLeft(el.scrollLeft);
  }, []);

  // Auto-follow playhead during playback
  useEffect(() => {
    if (!playing) return;
    const el = timelineContainerRef.current;
    if (!el || containerWidth <= 0 || pps <= 0) return;
    const playheadX = current * pps;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + containerWidth;
    const margin = containerWidth * 0.33;
    if (playheadX < viewLeft + margin * 0.5 || playheadX > viewRight - margin * 0.5) {
      el.scrollLeft = Math.max(0, playheadX - margin);
    }
  }, [current, playing, pps, containerWidth]);

  // Auto-scroll to selected mark when it's off-screen (only on selection change, not seek/zoom)
  useEffect(() => {
    if (!selectedMarkId || selectedMarkId === prevSelectedMarkIdRef.current) {
      prevSelectedMarkIdRef.current = selectedMarkId ?? null;
      return;
    }
    prevSelectedMarkIdRef.current = selectedMarkId;
    const el = timelineContainerRef.current;
    if (!el || containerWidth <= 0 || pps <= 0 || durationMs <= 0) return;
    const mark = (marks || []).find(m => m.id === selectedMarkId);
    if (!mark) return;
    const markX = (mark.t_ms / 1000) * pps;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + containerWidth;
    if (markX < viewLeft || markX > viewRight) {
      el.scrollLeft = Math.max(0, markX - containerWidth * 0.33);
    }
  }, [selectedMarkId, marks, pps, containerWidth, durationMs]);

  // Timeline wheel: Ctrl+wheel = zoom, plain wheel = horizontal scroll
  const handleTimelineWheel = useCallback((e: React.WheelEvent) => {
    const el = timelineContainerRef.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseTime = (el.scrollLeft + mouseX) / pps;
      const factor = e.deltaY > 0 ? 0.95 : 1.053;
      const newZoom = Math.max(1, Math.min(100, zoom * factor));
      setZoom(newZoom);
      requestAnimationFrame(() => {
        const newPps = basePps * newZoom;
        el.scrollLeft = mouseTime * newPps - mouseX;
      });
    } else {
      if (e.deltaX !== 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
  }, [zoom, pps, basePps]);

  const getTimelineZoomAnchorSeconds = useCallback(() => {
    const selectedMark = selectedMarkId
      ? (marks || []).find((mark) => mark.id === selectedMarkId)
      : null;
    const rawAnchor = selectedMark
      ? selectedMark.t_ms / 1000
      : videoRef.current?.currentTime ?? current;
    return Math.max(0, Math.min(duration || 0, rawAnchor));
  }, [current, duration, marks, selectedMarkId]);

  const handleZoomSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const nextZoom = Math.max(1, Math.min(100, parseFloat(e.target.value) || 1));
    const el = timelineContainerRef.current;
    const anchorSeconds = getTimelineZoomAnchorSeconds();
    setZoom(nextZoom);
    if (!el || containerWidth <= 0 || duration <= 0) return;
    requestAnimationFrame(() => {
      const nextPps = (containerWidth / duration) * nextZoom;
      const maxScrollLeft = Math.max(0, duration * nextPps - containerWidth);
      const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, anchorSeconds * nextPps - containerWidth / 2));
      el.scrollLeft = nextScrollLeft;
      setTlScrollLeft(nextScrollLeft);
    });
  }, [containerWidth, duration, getTimelineZoomAnchorSeconds]);

  // Click on track lane to seek
  const handleLaneMouseDown = useCallback((e: React.MouseEvent) => {
    if (locked) return;
    const el = timelineContainerRef.current;
    const v = videoRef.current;
    if (!el || !v) return;
    const rect = el.getBoundingClientRect();
    const seekToX = (clientX: number) => {
      const mx = clientX - rect.left + el.scrollLeft;
      const t = Math.max(0, Math.min(v.duration || 0, mx / pps));
      v.currentTime = t;
      setCurrent(t);
    };
    seekToX(e.clientX);
    setDragging(true);
    const onMove = (ev: MouseEvent) => seekToX(ev.clientX);
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [locked, pps]);

  return (
    <div ref={wrapperRef} className={`relative flex flex-col flex-1 min-h-0 overflow-hidden ${className ?? ''}`} style={style} tabIndex={0} onKeyDownCapture={onKeyDownCapture}>
      {/* Loading overlay */}
      <div className={`absolute inset-0 bg-surface items-center justify-center pointer-events-none z-[1] ${ready ? 'hidden' : 'flex'}`}>
        <div className="flex flex-col items-center gap-1.5">
          <div className="spinner" />
          <div className="text-xs text-secondary">Loading…</div>
        </div>
      </div>
      {/* Video */}
      <video
        ref={videoRef}
        src={src ?? undefined}
        preload={preload}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onLoadedData={onLoadedData}
        onError={handleMediaError}
        onClick={() => { wrapperRef.current?.focus(); if (!locked) togglePlay(); }}
        className="w-full block bg-black object-contain flex-1 min-h-0"
      />
      {/* Timeline panel */}
      <div className="shrink-0 bg-surface border-t border-border flex flex-col">
        {/* Scrollable timeline area */}
        <div
          ref={timelineContainerRef}
          className="overflow-x-auto overflow-y-hidden relative"
          onWheel={handleTimelineWheel}
          onScroll={handleTimelineScroll}
        >
          <div style={{ width: totalTimelineWidth, minWidth: '100%' }}>
            {/* Timecode ruler */}
            <div className="h-5 relative border-b border-subtle select-none">
              {ticks.map((tick, i) => (
                <div key={i} className="absolute top-0" style={{ left: tick.time * pps }}>
                  <div className={`w-px ${tick.major ? 'h-5 bg-secondary' : 'h-2.5 bg-subtle'}`} />
                  {tick.label && (
                    <span className="absolute top-0 left-1 text-[10px] text-muted whitespace-nowrap">{tick.label}</span>
                  )}
                </div>
              ))}
            </div>
            {/* Track lane */}
            <div
              className={`h-8 bg-raised relative ${locked ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
              onMouseDown={handleLaneMouseDown}
            >
              {/* Mark pips */}
              {(marks || []).map(m => {
                if (durationMs <= 0) return null;
                const x = (m.t_ms / 1000) * pps;
                const isSelected = m.id === selectedMarkId;
                const isHovered = m.id === hoverMarkId;
                return (
                  <div
                    key={m.id}
                    className="absolute top-0 bottom-0 cursor-pointer"
                    style={{ left: x - 4, width: 8 }}
                    onMouseEnter={() => setHoverMarkId(m.id)}
                    onMouseLeave={() => setHoverMarkId(prev => (prev === m.id ? null : prev))}
                    onClick={(e) => { e.stopPropagation(); if (onSelectMark) onSelectMark(m.id, m.t_ms); }}
                  >
                    <div
                      className="absolute top-0 bottom-0 left-1/2 w-[3px] -translate-x-1/2"
                      style={{ background: isSelected ? '#f97316' : '#fbbf24', opacity: isHovered ? 1 : 0.85 }}
                    />
                    {isHovered && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-surface border border-border text-[10px] text-accent whitespace-nowrap z-10">
                        {formatTime(m.t_ms)}{m.label ? ` · ${m.label}` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-[#ef4444] z-[2] pointer-events-none"
                style={{ left: current * pps }}
              />
            </div>
          </div>
        </div>
        {/* Transport bar */}
        <div className="flex items-stretch border-t border-border">
          <button disabled={locked} aria-label="Skip back" title="Skip back" onClick={() => largeNudge(-1)} className={`self-stretch px-3 py-1.5 border-0 border-r border-solid border-border ${btnTransition}`} style={activeBtnStyle('large-back')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 19 2 12 11 5"></polyline><line x1="22" y1="19" x2="22" y2="5"></line></svg>
          </button>
          <button disabled={locked} aria-label="Step back" title="Step back (frame)" onClick={() => step(-1)} className={`self-stretch px-3 py-1.5 border-0 border-r border-solid border-border ${btnTransition}`} style={activeBtnStyle('frame-back')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <button disabled={locked} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} onClick={togglePlay} className={`self-stretch px-3 py-1.5 border-0 border-r border-solid border-border ${btnTransition}`} style={activeBtnStyle('play')}>
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <button disabled={locked} aria-label="Step forward" title="Step forward (frame)" onClick={() => step(1)} className={`self-stretch px-3 py-1.5 border-0 border-r border-solid border-border ${btnTransition}`} style={activeBtnStyle('frame-forward')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          <button disabled={locked} aria-label="Skip forward" title="Skip forward" onClick={() => largeNudge(1)} className={`self-stretch px-3 py-1.5 border-0 border-r border-solid border-border ${btnTransition}`} style={activeBtnStyle('large-forward')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 19 22 12 13 5"></polyline><line x1="2" y1="19" x2="2" y2="5"></line></svg>
          </button>
          <div className="flex-1 flex items-center px-3">
            <span className="font-mono text-xs text-accent">{formatTime(Math.round(current * 1000))}</span>
            <span className="font-mono text-xs text-muted mx-1">/</span>
            <span className="font-mono text-xs text-muted">{formatTime(durationMs)}</span>
          </div>
          {showAddMarkButton && (
            <button disabled={locked} aria-label="Add mark" title="Add mark (M)" onClick={addMark} className={`self-stretch px-3 py-1.5 border-0 border-l border-solid border-border ${btnTransition}`} style={activeBtnStyle('mark')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h12v16l-6-4-6 4z"/></svg>
            </button>
          )}
          <div className="flex items-center px-3 gap-2 border-l border-solid border-border">
            <span className="text-[10px] text-muted">Zoom</span>
            <input
              type="range"
              min={1}
              max={100}
              step={0.1}
              value={zoom}
              onChange={handleZoomSliderChange}
              className="w-20 accent-[#3b82f6]"
            />
            <span className="text-[10px] text-muted font-mono w-8">×{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}</span>
          </div>
          {allowFullscreen && (
            <button disabled={locked} aria-label="Fullscreen" title="Fullscreen" onClick={toggleFullscreen} className={`self-stretch px-3 py-1.5 border-0 border-l border-solid border-border ${btnTransition}`} style={activeBtnStyle('fullscreen')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9"></polyline>
                <polyline points="9 21 3 21 3 15"></polyline>
                <line x1="21" y1="3" x2="14" y2="10"></line>
                <line x1="3" y1="21" x2="10" y2="14"></line>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const VideoPlayerUnit = forwardRef<VideoPlayerHandle, Props>(VideoPlayerUnitInner);
export default VideoPlayerUnit;
