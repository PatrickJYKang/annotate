"use client";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  clampFrame,
  frameToSeconds,
  mediaTimeToVideoFrame,
} from "../../lib/clip/frameMath";
import { useT } from "../../lib/i18n";
import { packTimelineIntervals } from "../../lib/media/timelineLanes";
import { createTimelineManualOverride } from "../../lib/media/timelineInteraction";
import { calculateTimelineScale } from "../../lib/media/timelineScale";

export type FrameRangeMarker = {
  id: string;
  startFrame: number;
  endFrame: number;
  label?: string;
  laneId?: string;
  pending?: boolean;
};

export type TimelineLane = {
  id: string;
  label: string;
  color?: string;
};

const EMPTY_FRAME_RANGES: FrameRangeMarker[] = [];
const EMPTY_TIMELINE_LANES: TimelineLane[] = [];

type Props = {
  src: string | null;
  fps?: number;
  preload?: "none" | "metadata" | "auto";
  onTimeUpdate?: () => void;
  onLoadedMetadata?: () => void;
  onLoadedData?: () => void;
  onError?: (event: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
  onPlayingChange?: (playing: boolean) => void;
  hotkeys?: boolean;
  allowFullscreen?: boolean;
  initialTime?: number;
  skipLargeSeconds?: number;
  className?: string;
  style?: React.CSSProperties;
  locked?: boolean;
  frameCount?: number;
  externalSeekFrame?: number | null;
  ranges?: FrameRangeMarker[];
  timelineLanes?: TimelineLane[];
  selectedRangeId?: string | null;
  onSelectRange?: (rangeId: string, startFrame: number) => void;
  onPresentedFrameChange?: (frame: number) => void;
};

export type VideoPlayerHandle = {
  playPause: () => Promise<void> | void;
  stepFrame: (dir: -1 | 1) => void;
  nudgeSmall: (dir: -1 | 1) => void;
  nudgeLarge: (dir: -1 | 1) => void;
  getCurrentFrame: () => number;
  seekFrame: (frame: number) => void;
  seekFrameAndReveal: (frame: number) => void;
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

function VideoPlayerUnitInner({ src, fps = 30, preload = "auto", onTimeUpdate, onLoadedMetadata, onLoadedData, onError, onPlayingChange, hotkeys = true, allowFullscreen = true, initialTime, skipLargeSeconds = 2, className, style, locked = false, frameCount, externalSeekFrame, ranges = EMPTY_FRAME_RANGES, timelineLanes = EMPTY_TIMELINE_LANES, selectedRangeId, onSelectRange, onPresentedFrameChange }: Props, ref: React.Ref<VideoPlayerHandle>) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const [activeBtn, setActiveBtn] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const [presentedFrame, setPresentedFrame] = useState(0);
  const presentedFrameRef = useRef(-1);
  const onPlayingChangeRef = useRef(onPlayingChange);

  useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange;
  }, [onPlayingChange]);

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
    const onPlay = () => {
      setPlaying(true);
      onPlayingChangeRef.current?.(true);
    };
    const onPause = () => {
      setPlaying(false);
      onPlayingChangeRef.current?.(false);
    };
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

  useEffect(() => {
    setReady(false);
    setPlaying(false);
    onPlayingChangeRef.current?.(false);
    presentedFrameRef.current = -1;
    setPresentedFrame(0);
  }, [src]);

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

  const effectiveFrameCount = frameCount && Number.isInteger(frameCount) && frameCount > 0
    ? frameCount
    : null;

  const publishPresentedFrame = useCallback((mediaTime: number) => {
    if (!effectiveFrameCount) return;
    const frame = mediaTimeToVideoFrame(mediaTime, fps, effectiveFrameCount);
    if (presentedFrameRef.current === frame) return;
    presentedFrameRef.current = frame;
    setPresentedFrame(frame);
    onPresentedFrameChange?.(frame);
  }, [effectiveFrameCount, fps, onPresentedFrameChange]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !effectiveFrameCount) return;
    const requestFrame = video.requestVideoFrameCallback?.bind(video);
    const cancelFrame = video.cancelVideoFrameCallback?.bind(video);
    if (!requestFrame || !cancelFrame) {
      publishPresentedFrame(video.currentTime);
      return;
    }
    let callbackId = 0;
    const callback: VideoFrameRequestCallback = (_now, metadata) => {
      publishPresentedFrame(metadata.mediaTime);
      callbackId = requestFrame(callback);
    };
    callbackId = requestFrame(callback);
    return () => cancelFrame(callbackId);
  }, [effectiveFrameCount, publishPresentedFrame, src]);

  useEffect(() => {
    if (!effectiveFrameCount) return;
    const video = videoRef.current;
    if (!video?.requestVideoFrameCallback) publishPresentedFrame(current);
  }, [current, effectiveFrameCount, publishPresentedFrame]);

  const getCurrentFrame = useCallback((): number => {
    if (!effectiveFrameCount) return 0;
    const video = videoRef.current;
    return mediaTimeToVideoFrame(video?.currentTime ?? 0, fps, effectiveFrameCount);
  }, [effectiveFrameCount, fps]);

  const seekFrame = useCallback((frame: number) => {
    if (!effectiveFrameCount) return;
    const video = videoRef.current;
    if (!video) return;
    const next = clampFrame(frame, effectiveFrameCount);
    const seconds = frameToSeconds(next, fps);
    video.currentTime = seconds;
    setCurrent(seconds);
    presentedFrameRef.current = next;
    setPresentedFrame(next);
    onPresentedFrameChange?.(next);
  }, [effectiveFrameCount, fps, onPresentedFrameChange]);

  useEffect(() => {
    if (externalSeekFrame == null) return;
    seekFrame(externalSeekFrame);
  }, [externalSeekFrame, seekFrame]);

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
    if (effectiveFrameCount) {
      seekFrame(getCurrentFrame() + dir);
    } else {
      const dt = 1 / (fps || 30);
      v.currentTime = Math.max(0, Math.min(v.duration || Number.MAX_SAFE_INTEGER, v.currentTime + dir * dt));
      setCurrent(v.currentTime);
    }
    setActiveBtn(dir < 0 ? 'frame-back' : 'frame-forward'); if (flashTimer.current) clearTimeout(flashTimer.current); flashTimer.current = window.setTimeout(() => setActiveBtn(null), 150);
  }, [effectiveFrameCount, fps, getCurrentFrame, locked, seekFrame]);

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
  }, [hotkeys, largeNudge, locked, nudge, step, togglePlay]);

  // --- Timeline state ---
  const [zoom, setZoom] = useState(1);
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineManualOverrideRef = useRef<ReturnType<typeof createTimelineManualOverride> | null>(null);
  const ignoreTimelineScrollRef = useRef(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [tlScrollLeft, setTlScrollLeft] = useState(0);
  if (!timelineManualOverrideRef.current) {
    timelineManualOverrideRef.current = createTimelineManualOverride();
  }

  const setTimelineScrollLeftProgrammatically = useCallback((element: HTMLDivElement, scrollLeft: number) => {
    ignoreTimelineScrollRef.current = true;
    element.scrollLeft = scrollLeft;
    requestAnimationFrame(() => {
      ignoreTimelineScrollRef.current = false;
    });
  }, []);

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
  const timelineScale = calculateTimelineScale(duration, containerWidth, zoom);
  const {
    defaultVisibleSeconds,
    minimumZoom,
    maximumZoom,
    basePixelsPerSecond: basePps,
    pixelsPerSecond: pps,
    totalWidth: totalTimelineWidth,
  } = timelineScale;

  useEffect(() => {
    setZoom((currentZoom) => Math.max(minimumZoom, Math.min(maximumZoom, currentZoom)));
  }, [maximumZoom, minimumZoom]);

  const revealTimelineFrame = useCallback((frame: number) => {
    const element = timelineContainerRef.current;
    if (!element || !effectiveFrameCount || containerWidth <= 0 || pps <= 0) return;
    const frameX = frameToSeconds(clampFrame(frame, effectiveFrameCount), fps) * pps;
    const maxScrollLeft = Math.max(0, totalTimelineWidth - containerWidth);
    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, frameX - containerWidth / 2));
    setTimelineScrollLeftProgrammatically(element, nextScrollLeft);
    setTlScrollLeft(nextScrollLeft);
  }, [containerWidth, effectiveFrameCount, fps, pps, setTimelineScrollLeftProgrammatically, totalTimelineWidth]);

  const seekFrameAndReveal = useCallback((frame: number) => {
    seekFrame(frame);
    revealTimelineFrame(frame);
  }, [revealTimelineFrame, seekFrame]);

  useImperativeHandle(ref, () => ({
    playPause: togglePlay,
    stepFrame: (dir: -1 | 1) => step(dir),
    nudgeSmall: (dir: -1 | 1) => nudge(dir),
    nudgeLarge: (dir: -1 | 1) => largeNudge(dir),
    getCurrentFrame,
    seekFrame,
    seekFrameAndReveal,
    getVideoElement: () => videoRef.current,
  }), [getCurrentFrame, largeNudge, nudge, seekFrame, seekFrameAndReveal, step, togglePlay]);

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
    if (!el) return;
    if (!ignoreTimelineScrollRef.current) timelineManualOverrideRef.current?.mark();
    setTlScrollLeft(el.scrollLeft);
  }, []);

  // Auto-follow playhead during playback
  useEffect(() => {
    if (!playing) return;
    if (timelineManualOverrideRef.current?.isActive()) return;
    const el = timelineContainerRef.current;
    if (!el || containerWidth <= 0 || pps <= 0) return;
    const playheadX = current * pps;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + containerWidth;
    const margin = containerWidth * 0.33;
    if (playheadX < viewLeft + margin * 0.5 || playheadX > viewRight - margin * 0.5) {
      setTimelineScrollLeftProgrammatically(el, Math.max(0, playheadX - margin));
    }
  }, [containerWidth, current, playing, pps, setTimelineScrollLeftProgrammatically]);

  // Timeline wheel: Ctrl+wheel = zoom, plain wheel = horizontal scroll
  const handleTimelineWheel = useCallback((e: React.WheelEvent) => {
    const el = timelineContainerRef.current;
    if (!el) return;
    timelineManualOverrideRef.current?.mark();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseTime = (el.scrollLeft + mouseX) / pps;
      const factor = e.deltaY > 0 ? 2 ** -0.1 : 2 ** 0.1;
      const newZoom = Math.max(minimumZoom, Math.min(maximumZoom, zoom * factor));
      setZoom(newZoom);
      requestAnimationFrame(() => {
        const newPps = basePps * newZoom;
        setTimelineScrollLeftProgrammatically(el, mouseTime * newPps - mouseX);
      });
    } else {
      if (e.deltaX !== 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
  }, [zoom, pps, basePps, maximumZoom, minimumZoom, setTimelineScrollLeftProgrammatically]);

  const getTimelineZoomAnchorSeconds = useCallback(() => {
    const rawAnchor = videoRef.current?.currentTime ?? current;
    return Math.max(0, Math.min(duration || 0, rawAnchor));
  }, [current, duration]);

  const handleZoomSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    timelineManualOverrideRef.current?.mark();
    const exponent = parseFloat(e.target.value);
    const nextZoom = Math.max(minimumZoom, Math.min(maximumZoom, 2 ** (Number.isFinite(exponent) ? exponent : 0)));
    const el = timelineContainerRef.current;
    const anchorSeconds = getTimelineZoomAnchorSeconds();
    setZoom(nextZoom);
    if (!el || containerWidth <= 0 || duration <= 0) return;
    requestAnimationFrame(() => {
      const nextPps = (containerWidth / defaultVisibleSeconds) * nextZoom;
      const maxScrollLeft = Math.max(0, duration * nextPps - containerWidth);
      const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, anchorSeconds * nextPps - containerWidth / 2));
      setTimelineScrollLeftProgrammatically(el, nextScrollLeft);
      setTlScrollLeft(nextScrollLeft);
    });
  }, [containerWidth, defaultVisibleSeconds, duration, getTimelineZoomAnchorSeconds, maximumZoom, minimumZoom, setTimelineScrollLeftProgrammatically]);

  const zoomLabel = zoom >= 10
    ? String(Math.round(zoom))
    : zoom >= 1
      ? zoom.toFixed(zoom === 1 ? 0 : 1)
      : zoom >= 0.1
        ? zoom.toFixed(2)
        : zoom.toFixed(3);

  const laneLayouts = useMemo(() => {
    let top = 0;
    return timelineLanes.map((lane, laneIndex) => {
      const packed = packTimelineIntervals(ranges.filter((range) => range.laneId === lane.id));
      const height = 8 + Math.max(1, packed.trackCount) * 22;
      const layout = { lane, laneIndex, top, height, packed };
      top += height;
      return layout;
    });
  }, [ranges, timelineLanes]);
  const laneAreaHeight = laneLayouts.reduce((height, lane) => height + lane.height, 0);
  const unassignedRanges = useMemo(
    () => ranges.filter((range) => !range.laneId || !timelineLanes.some((lane) => lane.id === range.laneId)),
    [ranges, timelineLanes],
  );
  const hasTimelineLanes = laneLayouts.length > 0;

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
      if (effectiveFrameCount) seekFrame(Math.floor(t * fps + 1e-7));
      else {
        v.currentTime = t;
        setCurrent(t);
      }
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
  }, [effectiveFrameCount, fps, locked, pps, seekFrame]);

  const renderRangeMarker = (
    range: FrameRangeMarker,
    markerTop: number,
    markerHeight: number,
    zIndex = 2,
    global = false,
  ): React.ReactNode => {
    if (!effectiveFrameCount || range.endFrame <= range.startFrame) return null;
    const left = (range.startFrame / fps) * pps;
    const width = Math.max(3, ((range.endFrame - range.startFrame) / fps) * pps);
    const selected = range.id === selectedRangeId;
    const label = range.label ?? range.id;
    const markerStyle: React.CSSProperties = {
      left,
      top: markerTop,
      width,
      height: markerHeight,
      zIndex,
      background: range.pending
        ? 'rgba(245, 158, 11, 0.28)'
        : selected
          ? 'rgba(249, 115, 22, 0.5)'
          : global
            ? 'rgba(148, 163, 184, 0.12)'
            : 'rgba(59, 130, 246, 0.32)',
      borderColor: range.pending
        ? '#fbbf24'
        : selected
          ? '#fb923c'
          : global
            ? '#64748b'
            : '#60a5fa',
      borderStyle: range.pending ? 'dashed' : 'solid',
    };
    const content = (
      <span className="flex h-full min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap px-1.5">
        {range.pending && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </span>
    );

    if (range.pending) {
      return (
        <div
          key={range.id}
          data-testid={`video-range-${range.id}`}
          data-pending="true"
          aria-label={t('video.captureInProgress', { label, start: range.startFrame })}
          className="absolute overflow-hidden rounded-sm border text-left text-[10px] leading-none text-warning"
          style={markerStyle}
          title={t('video.captureInProgress', { label, start: range.startFrame })}
        >
          {content}
        </div>
      );
    }

    return (
      <button
        key={range.id}
        type="button"
        data-testid={`video-range-${range.id}`}
        aria-label={t('video.clipAria', { label })}
        className="absolute overflow-hidden border px-0 py-0 text-left text-[10px] leading-none"
        style={markerStyle}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onSelectRange?.(range.id, range.startFrame);
        }}
        title={t('video.clipTitle', {
          label,
          start: range.startFrame,
          end: range.endFrame - 1,
        })}
      >
        {content}
      </button>
    );
  };

  return (
    <div ref={wrapperRef} className={`relative flex flex-col flex-1 min-h-0 overflow-hidden ${className ?? ''}`} style={style} tabIndex={0} onKeyDownCapture={onKeyDownCapture}>
      {/* Loading overlay */}
      <div className={`absolute inset-0 bg-surface items-center justify-center pointer-events-none z-[1] ${ready ? 'hidden' : 'flex'}`}>
        <div className="flex flex-col items-center gap-1.5">
          <div className="spinner" />
          <div className="text-xs text-secondary">{t('video.loading')}</div>
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
        <div className="flex min-w-0 items-stretch">
          <div
            ref={timelineContainerRef}
            data-testid="video-timeline-scroller"
            className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
            onWheel={handleTimelineWheel}
            onScroll={handleTimelineScroll}
          >
            <div style={{ width: totalTimelineWidth, minWidth: '100%' }}>
              <div className="relative h-5 select-none border-b border-subtle">
                {ticks.map((tick, i) => (
                  <div key={i} className="absolute top-0" style={{ left: tick.time * pps }}>
                    <div className={`w-px ${tick.major ? 'h-5 bg-secondary' : 'h-2.5 bg-subtle'}`} />
                    {tick.label && (
                      <span className="absolute left-1 top-0 whitespace-nowrap text-[10px] text-muted">{tick.label}</span>
                    )}
                  </div>
                ))}
              </div>
              {hasTimelineLanes ? (
                <div
                  data-testid="video-range-lanes"
                  className={`relative bg-raised ${locked ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
                  style={{ height: laneAreaHeight }}
                  onMouseDown={handleLaneMouseDown}
                >
                  {unassignedRanges.map((range) => renderRangeMarker(
                    range,
                    2,
                    Math.max(18, laneAreaHeight - 4),
                    1,
                    true,
                  ))}
                  {laneLayouts.map(({ lane, laneIndex, top, height, packed }) => (
                    <div
                      key={lane.id}
                      data-testid={`video-range-lane-${lane.id}`}
                      className="absolute left-0 right-0 border-b border-subtle"
                      style={{
                        top,
                        height,
                        background: laneIndex % 2 === 0 ? 'rgba(255, 255, 255, 0.018)' : 'transparent',
                        borderLeft: `3px solid ${lane.color ?? '#60a5fa'}`,
                      }}
                    >
                      {packed.placements.map(({ interval, trackIndex }) => renderRangeMarker(
                        interval,
                        4 + trackIndex * 22,
                        18,
                        2,
                      ))}
                    </div>
                  ))}
                  <div
                    data-testid="video-timeline-playhead"
                    className="pointer-events-none absolute bottom-0 top-0 z-[3] w-[2px] bg-[#ef4444]"
                    style={{ left: current * pps }}
                  />
                </div>
              ) : (
                <div
                  className={`relative h-8 bg-raised ${locked ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
                  onMouseDown={handleLaneMouseDown}
                >
                  {ranges.map((range) => renderRangeMarker(range, 4, 24))}
                  <div
                    data-testid="video-timeline-playhead"
                    className="pointer-events-none absolute bottom-0 top-0 z-[3] w-[2px] bg-[#ef4444]"
                    style={{ left: current * pps }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Transport bar */}
        <div className="flex items-stretch border-t border-border">
          <button disabled={locked} aria-label={t('video.skipBack')} title={t('video.skipBack')} onClick={() => largeNudge(-1)} className={`self-stretch px-3 py-1.5 border-0 border-r border-solid border-border ${btnTransition}`} style={activeBtnStyle('large-back')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 19 2 12 11 5"></polyline><line x1="22" y1="19" x2="22" y2="5"></line></svg>
          </button>
          <button disabled={locked} aria-label={t('video.stepBack')} title={t('video.stepBackTitle')} onClick={() => step(-1)} className={`self-stretch px-3 py-1.5 border-0 border-r border-solid border-border ${btnTransition}`} style={activeBtnStyle('frame-back')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <button disabled={locked} aria-label={playing ? t('video.pause') : t('video.play')} title={playing ? t('video.pause') : t('video.play')} onClick={togglePlay} className={`self-stretch px-3 py-1.5 border-0 border-r border-solid border-border ${btnTransition}`} style={activeBtnStyle('play')}>
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <button disabled={locked} aria-label={t('video.stepForward')} title={t('video.stepForwardTitle')} onClick={() => step(1)} className={`self-stretch px-3 py-1.5 border-0 border-r border-solid border-border ${btnTransition}`} style={activeBtnStyle('frame-forward')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          <button disabled={locked} aria-label={t('video.skipForward')} title={t('video.skipForward')} onClick={() => largeNudge(1)} className={`self-stretch px-3 py-1.5 border-0 border-r border-solid border-border ${btnTransition}`} style={activeBtnStyle('large-forward')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 19 22 12 13 5"></polyline><line x1="2" y1="19" x2="2" y2="5"></line></svg>
          </button>
          <div className="flex-1 flex items-center px-3">
            <span className="font-mono text-xs text-accent">{formatTime(Math.round(current * 1000))}</span>
            <span className="font-mono text-xs text-muted mx-1">/</span>
            <span className="font-mono text-xs text-muted">{formatTime(durationMs)}</span>
            {effectiveFrameCount && (
              <span className="ml-2 font-mono text-[10px] text-muted">f{presentedFrame}</span>
            )}
          </div>
          <div className="flex items-center px-3 gap-2 border-l border-solid border-border">
            <span className="text-[10px] text-muted">{t('video.zoom')}</span>
            <input
              type="range"
              min={Math.log2(minimumZoom)}
              max={Math.log2(maximumZoom)}
              step={0.1}
              value={Math.log2(zoom)}
              onChange={handleZoomSliderChange}
              className="w-20 accent-[#3b82f6]"
            />
            <span className="w-11 font-mono text-[10px] text-muted">×{zoomLabel}</span>
          </div>
          {allowFullscreen && (
            <button disabled={locked} aria-label={t('video.fullscreen')} title={t('video.fullscreen')} onClick={toggleFullscreen} className={`self-stretch px-3 py-1.5 border-0 border-l border-solid border-border ${btnTransition}`} style={activeBtnStyle('fullscreen')}>
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
