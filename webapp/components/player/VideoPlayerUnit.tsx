"use client";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { TaggingSelection } from "../../lib/tagging/schema";

type Mark = { id: string; t_ms: number; tags?: TaggingSelection | string[]; label?: string };

type Props = {
  src: string | null;
  fps?: number;
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

function VideoPlayerUnitInner({ src, fps = 30, hotkeys = true, allowFullscreen = true, onAddMark, onToggleTag, initialTime, externalSeekMs, skipLargeSeconds = 2, className, style, marks = [], selectedMarkId, onSelectMark, showAddMarkButton = true, enableMarkHotkey = true, locked = false, videoHeight }: Props, ref: React.Ref<VideoPlayerHandle>) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const seekRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const [activeBtn, setActiveBtn] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const [hoverMarkId, setHoverMarkId] = useState<string | null>(null);

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

  const percent = duration > 0 ? Math.max(0, Math.min(100, (current / duration) * 100)) : 0;
  const durationMs = Math.floor(duration * 1000);

  const seekToClientX = useCallback((clientX: number) => {
    const bar = seekRef.current;
    const v = videoRef.current;
    if (!bar || !v || !(bar instanceof HTMLElement)) return;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(rect.left, Math.min(rect.right, clientX));
    const ratio = rect.width > 0 ? (x - rect.left) / rect.width : 0;
    const t = ratio * (v.duration || 0);
    v.currentTime = t;
    setCurrent(t);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (locked) return;
    setDragging(true);
    seekToClientX(e.clientX);
    const onMove = (ev: MouseEvent) => seekToClientX(ev.clientX);
    const onUp = () => { setDragging(false); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [seekToClientX, locked]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (locked) return;
    setDragging(true);
    if (e.touches[0]) seekToClientX(e.touches[0].clientX);
    const onMove = (ev: TouchEvent) => { if (ev.touches[0]) seekToClientX(ev.touches[0].clientX); };
    const onEnd = () => { setDragging(false); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); window.removeEventListener("touchcancel", onEnd); };
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
  }, [seekToClientX, locked]);

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

  const markPercents = useMemo(() => {
    const d = durationMs > 0 ? durationMs : 0;
    if (d <= 0) return [] as { id: string; p: number; t_ms: number }[];
    return (marks || []).map(m => ({ id: m.id, p: Math.max(0, Math.min(100, (m.t_ms / d) * 100)), t_ms: m.t_ms }));
  }, [marks, durationMs]);

  const selectedPercent = useMemo(() => {
    if (!selectedMarkId) return null as number | null;
    const d = durationMs > 0 ? durationMs : 0;
    if (d <= 0) return null;
    const found = (marks || []).find(m => m.id === selectedMarkId);
    if (!found) return null;
    return Math.max(0, Math.min(100, (found.t_ms / d) * 100));
  }, [selectedMarkId, marks, durationMs]);

  return (
    <div ref={wrapperRef} className={`relative overflow-hidden ${className ?? ''}`} style={style} tabIndex={0} onKeyDownCapture={onKeyDownCapture}>
      {/* 16:9 overlay placeholder while loading metadata */}
      <div className={`absolute inset-0 items-center justify-center pointer-events-none z-[1] ${ready ? 'hidden' : 'flex'}`}>
        <div className="w-full aspect-video bg-surface border border-raised flex items-center justify-center">
          <div className="flex flex-col items-center gap-1.5">
            <div className="spinner" />
            <div className="text-xs text-secondary">Loading…</div>
          </div>
        </div>
      </div>
      <video
        ref={videoRef}
        src={src ?? undefined}
        onClick={() => { wrapperRef.current?.focus(); if (!locked) togglePlay(); }}
        className="w-full block bg-black object-contain"
        style={{ height: videoHeight || 'calc(100vh - var(--player-headroom))' }}
      />
      <div className="absolute left-0 right-0 bottom-0 p-2 z-[3]" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.0), rgba(0,0,0,0.55))' }}>
        <div ref={seekRef} className={`relative h-3 bg-raised rounded-full ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}`} onMouseDown={onMouseDown} onTouchStart={onTouchStart}>
          <div className="absolute top-0 left-0 bottom-0 bg-[#3b82f6] rounded-full" style={{ width: `${percent}%` }} />
          <div className="absolute top-0 w-3 h-3 rounded-full bg-[#93c5fd]" style={{ left: `${percent}%`, transform: 'translateX(-50%)' }} />
          {markPercents.map(({ id, p, t_ms }) => (
            <div
              key={id}
              onMouseEnter={() => setHoverMarkId(id)}
              onMouseLeave={() => setHoverMarkId(prev => (prev === id ? null : prev))}
              onClick={(e) => { e.stopPropagation(); if (onSelectMark) onSelectMark(id, t_ms); }}
              className="absolute w-3 h-7 cursor-pointer bg-transparent"
              style={{ top: -8, left: `${p}%`, transform: 'translateX(-50%)' }}
            >
              <div className="absolute left-1/2 w-[3px] rounded-sm opacity-95" style={{ top: hoverMarkId === id ? -6 : -4, height: hoverMarkId === id ? 26 : 20, transform: 'translateX(-50%)', background: id === selectedMarkId ? '#f97316' : '#fbbf24' }} />
            </div>
          ))}
          {selectedPercent != null && (
            <div className="absolute w-[3px] h-6 rounded-sm bg-[#f97316]" style={{ top: -6, left: `${selectedPercent}%`, transform: 'translateX(-50%)' }} />
          )}
        </div>
        <div className="flex gap-2 items-center mt-2">
          {/* Large skip backward */}
          <button disabled={locked} aria-label="Skip back" title="Skip back" onClick={() => largeNudge(-1)} className={btnTransition} style={activeBtnStyle('large-back')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 19 2 12 11 5"></polyline><line x1="22" y1="19" x2="22" y2="5"></line></svg>
          </button>
          {/* Frame step backward */}
          <button disabled={locked} aria-label="Step back" title="Step back (frame)" onClick={() => step(-1)} className={btnTransition} style={activeBtnStyle('frame-back')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          {/* Play/Pause */}
          <button disabled={locked} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} onClick={togglePlay} className={btnTransition} style={activeBtnStyle('play')}>
            {playing ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          {/* Frame step forward */}
          <button disabled={locked} aria-label="Step forward" title="Step forward (frame)" onClick={() => step(1)} className={btnTransition} style={activeBtnStyle('frame-forward')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          {/* Large skip forward */}
          <button disabled={locked} aria-label="Skip forward" title="Skip forward" onClick={() => largeNudge(1)} className={btnTransition} style={activeBtnStyle('large-forward')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 19 22 12 13 5"></polyline><line x1="2" y1="19" x2="2" y2="5"></line></svg>
          </button>
          <div className="flex-1" />
          <div className="status">{formatTimeNoMs(Math.round(current * 1000))} / {formatTimeNoMs(durationMs)}</div>
          {showAddMarkButton && (
            <button disabled={locked} aria-label="Add mark" title="Add mark" onClick={addMark} className={btnTransition} style={activeBtnStyle('mark')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h12v16l-6-4-6 4z"/></svg>
            </button>
          )}
          {allowFullscreen && (
            <button disabled={locked} aria-label="Fullscreen" title="Fullscreen" onClick={toggleFullscreen} className={btnTransition} style={activeBtnStyle('fullscreen')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
