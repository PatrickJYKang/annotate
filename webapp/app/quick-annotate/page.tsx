"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import ColorLinkToggle from "../../components/annotate/ColorLinkToggle";
import type { Tool, StrokePattern } from "../../components/annotate/Editor";
import { buildAnnotationPath, readAnnotationDocument } from "../../lib/fs/annotationStorage";
import { renderAnnotatedPng, type AnnotationsV1 } from "../../lib/export/d7Render";
import { registerVideoFile, requestHomography, unregisterVideoRef } from "../../lib/clip/sidecarClient";
import { resolveUsableHomographyAtTime } from "../../lib/clip/homographyInterpolation";
import { projectPitchBoundsToPerspectiveQuad } from "../../lib/annotate/pitchCalibration";
import type { HomographyFrame } from "../../lib/fs/homographyCache";
import {
  getQuickAnnotateDir,
  isQuickAnnotateSupported,
  quickExportFileName,
  quickStillIdForFile,
  takeQuickAnnotateFile,
} from "../../lib/annotate/quickSession";

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2400);
    return () => clearTimeout(t);
  }, [msg]);
  return { msg, show: setMsg } as const;
}

export default function QuickAnnotatePage() {
  const router = useRouter();
  const [projectDir, setProjectDir] = useState<FileSystemDirectoryHandle | null>(null);
  const { msg, show } = useToast();

  const Editor = useMemo(() => dynamic(() => import("../../components/annotate/Editor"), { ssr: false }), []);

  const [mounted, setMounted] = useState(false);
  const [supported, setSupported] = useState(true);
  const [file, setFile] = useState<File | null>(() => takeQuickAnnotateFile());
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [tool, setTool] = useState<Tool>('select');
  const [strokePattern, setStrokePattern] = useState<StrokePattern>('solid');
  const [defaultColor, setDefaultColor] = useState<string>('#000000');
  const [defaultStrokeWidth, setDefaultStrokeWidth] = useState<number>(6);
  const [defaultFill, setDefaultFill] = useState<string>('#000000');
  const [defaultColorsLinked, setDefaultColorsLinked] = useState(true);
  const [defaultFillOpacity, setDefaultFillOpacity] = useState<number>(0.3);
  const [defaultFontSize, setDefaultFontSize] = useState<number>(48);
  const [defaultTextHighlight, setDefaultTextHighlight] = useState<boolean>(false);

  const [saveTick, setSaveTick] = useState(0);
  const [saveStatus, setSaveStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'error'; at?: string; message?: string } | null>(null);
  const saveWaitersRef = useRef<Array<() => void>>([]);
  const [exporting, setExporting] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [autoPerspectiveQuad, setAutoPerspectiveQuad] = useState<Array<{ x: number; y: number }> | null>(null);
  const [autoPerspectiveTick, setAutoPerspectiveTick] = useState(0);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const offsetStartRef = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fittedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setSupported(isQuickAnnotateSupported());
  }, []);

  // Connect the OPFS session directory once.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      try {
        const dir = await getQuickAnnotateDir();
        if (!cancelled) setProjectDir(dir);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to open quick-annotate storage');
      }
    })();
    return () => { cancelled = true; };
  }, [supported, setProjectDir]);

  // Object URL for display (consumed by the Editor's image loader).
  useEffect(() => {
    if (!file) {
      setImgUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setImgUrl(null);
    };
  }, [file]);

  // Natural dimensions, decoded straight from the file. Deliberately not via an
  // <img src=objectURL> probe: React Strict Mode re-runs effects, and revoking
  // the first run's URL mid-load made the probe report a bogus decode error.
  useEffect(() => {
    if (!file) {
      setImgSize(null);
      return;
    }
    let cancelled = false;
    setImgSize(null);
    (async () => {
      try {
        const bmp = await createImageBitmap(file);
        if (!cancelled) setImgSize({ w: bmp.width, h: bmp.height });
        bmp.close();
      } catch {
        if (!cancelled) setError('Could not decode that image file.');
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  const stillId = useMemo(() => (file ? quickStillIdForFile(file) : null), [file]);
  const annotationFilePath = useMemo(() => (stillId ? buildAnnotationPath(stillId, 'default') : null), [stillId]);
  const imageInfo = useMemo(() => ({
    file: file?.name || '',
    width: imgSize?.w || 0,
    height: imgSize?.h || 0,
  }), [file, imgSize]);

  const onSaveStatus = useCallback((s: { state: 'idle' | 'saving' | 'saved' | 'error'; at?: string; message?: string }) => {
    setSaveStatus(s);
    if (s.state === 'saved' || s.state === 'error') {
      const waiters = saveWaitersRef.current;
      saveWaitersRef.current = [];
      for (const w of waiters) w();
    }
  }, []);

  useEffect(() => {
    if (!saveStatus) return;
    if (saveStatus.state === 'saving' || saveStatus.state === 'error') return;
    const ms = saveStatus.message === 'already_saved' ? 1000 : 1200;
    const t = window.setTimeout(() => setSaveStatus(null), ms);
    return () => window.clearTimeout(t);
  }, [saveStatus]);

  // --- Zoom / pan (mirrors the annotate page) ---
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  useEffect(() => {
    const onWheelNative = (e: WheelEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
      e.preventDefault();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const prev = scaleRef.current;
      const next = Math.min(8, Math.max(0.1, prev * (1 + (-e.deltaY * 0.001))));
      const contentX = (cx - offsetRef.current.x) / prev;
      const contentY = (cy - offsetRef.current.y) / prev;
      setScale(next);
      setOffset({ x: cx - contentX * next, y: cy - contentY * next });
    };
    document.addEventListener('wheel', onWheelNative, { passive: false });
    return () => document.removeEventListener('wheel', onWheelNative);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 1) {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      setPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY };
      offsetStartRef.current = { ...offset };
    }
  }, [offset]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!panning || !panStartRef.current || !offsetStartRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setOffset({ x: offsetStartRef.current.x + dx, y: offsetStartRef.current.y + dy });
  }, [panning]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (panning) {
      setPanning(false);
      panStartRef.current = null;
      offsetStartRef.current = null;
      try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {}
    }
  }, [panning]);

  const applyFit = useCallback((mode: 'fit' | 'actual') => {
    const el = containerRef.current;
    if (!el || !imgSize) return;
    const rect = el.getBoundingClientRect();
    const cw = Math.max(1, rect.width);
    const ch = Math.max(1, rect.height);
    const next = mode === 'actual' ? 1 : Math.min(1, cw / imgSize.w, ch / imgSize.h);
    setScale(next);
    setOffset({ x: (cw - imgSize.w * next) / 2, y: (ch - imgSize.h * next) / 2 });
  }, [imgSize]);

  // Fit once per image after dimensions are known.
  useEffect(() => {
    if (!imgSize || !stillId) return;
    if (fittedKeyRef.current === stillId) return;
    fittedKeyRef.current = stillId;
    applyFit('fit');
  }, [imgSize, stillId, applyFit]);

  // --- Toolbar defaults (mirrors the annotate page) ---
  const handleDefaultStrokeColorChange = useCallback((value: string) => {
    const next = value || '#000000';
    setDefaultColor(next);
    if (defaultColorsLinked) setDefaultFill(next);
  }, [defaultColorsLinked]);
  const handleDefaultFillColorChange = useCallback((value: string) => {
    const next = value || '#000000';
    setDefaultFill(next);
    if (defaultColorsLinked) setDefaultColor(next);
  }, [defaultColorsLinked]);
  const toggleDefaultColorsLinked = useCallback(() => {
    const next = !defaultColorsLinked;
    setDefaultColorsLinked(next);
    if (next) setDefaultFill(defaultColor);
  }, [defaultColor, defaultColorsLinked]);

  const hasStroke = ['box', 'circle', 'highlight', 'shadow', 'arrow', 'lob', 'poly', 'text'].includes(tool);
  const hasWidth = ['box', 'circle', 'highlight', 'shadow', 'arrow', 'lob', 'poly'].includes(tool);
  const hasPattern = ['box', 'circle', 'highlight', 'shadow', 'arrow', 'lob', 'poly'].includes(tool);
  const hasFill = ['box', 'circle', 'highlight', 'shadow', 'poly'].includes(tool);
  const hasFont = tool === 'text';

  // --- File selection ---
  const acceptFile = useCallback((f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name)) {
      show('Please choose an image file');
      return;
    }
    setError(null);
    setTool('select');
    setFile(f);
  }, [show]);

  const onPickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    acceptFile(f);
  }, [acceptFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = Array.from(e.dataTransfer.files || [])[0];
    acceptFile(f);
  }, [acceptFile]);

  const handleNewImage = useCallback(() => {
    setFile(null);
    setError(null);
    setSaveStatus(null);
    setAutoPerspectiveQuad(null);
    fittedKeyRef.current = null;
  }, []);

  // PnLCalib auto-calibration. The sidecar's /homography endpoint reads frames
  // through cv2.VideoCapture, which opens a registered still image as a
  // single-frame source — so the project workflow works for a lone image too.
  const handleAutoCalibrate = useCallback(async () => {
    if (!file || isCalibrating) return;
    setIsCalibrating(true);
    let videoRef: string | null = null;
    try {
      const registered = await registerVideoFile(file);
      videoRef = registered.videoRef;
      const result = await requestHomography({ videoRef, startMs: 0, endMs: 100, fps: 5 });
      const frames: HomographyFrame[] = result.frames.map((frame) => ({
        tMs: frame.tMs,
        matrix: frame.matrix,
        method: frame.method,
      }));
      const matrix = resolveUsableHomographyAtTime(frames, 0);
      const quad = projectPitchBoundsToPerspectiveQuad(matrix);
      if (!quad) {
        throw new Error('PnLCalib ran, but no usable homography was found for this image');
      }
      setAutoPerspectiveQuad(quad);
      setAutoPerspectiveTick((tick) => tick + 1);
      setTool('select');
      show('PnLCalib applied');
    } catch (e: any) {
      const message = e?.message || String(e);
      show(/failed to fetch/i.test(message) ? 'Calibration needs the Python sidecar running' : message);
    } finally {
      if (videoRef) void unregisterVideoRef(videoRef);
      setIsCalibrating(false);
    }
  }, [file, isCalibrating, show]);

  // --- Export ---
  const exportPng = useCallback(async () => {
    if (!file || !stillId) return;
    setExporting(true);
    try {
      // Flush any pending edits: bump the manual save tick, then wait for the
      // editor to report the save settled (or time out — e.g. nothing drawn yet).
      if (projectDir && annotationFilePath) {
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 3000);
          saveWaitersRef.current.push(() => { window.clearTimeout(timer); resolve(); });
          setSaveTick((t) => t + 1);
        });
      }
      const bmp = await createImageBitmap(file);
      try {
        const saved = (projectDir && annotationFilePath)
          ? await readAnnotationDocument(projectDir, annotationFilePath)
          : null;
        const ann: AnnotationsV1 = saved?.schema === 'annotations.v1' ? saved : {
          schema: 'annotations.v1',
          stillId,
          image: { file: file.name, width: bmp.width, height: bmp.height },
          shapes: [],
        };
        const blob = await renderAnnotatedPng({ bmp, ann });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = quickExportFileName(file);
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        show('Annotated PNG exported');
      } finally {
        if (typeof (bmp as any).close === 'function') (bmp as any).close();
      }
    } catch (e: any) {
      show(e?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [file, stillId, projectDir, annotationFilePath, show]);

  // --- Styling helpers (mirrors the annotate page) ---
  const toolBtnCls = (t: Tool) =>
    `self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base cursor-pointer ${
      tool === t ? 'bg-active text-white' : 'bg-surface text-primary'
    }`;
  const actionBtnCls =
    'self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base cursor-pointer bg-canvas text-primary disabled:opacity-50 disabled:cursor-not-allowed';
  const saveStatusCls =
    saveStatus?.state === 'error' ? 'text-danger'
    : saveStatus?.state === 'saving' ? 'text-warning'
    : saveStatus?.state === 'saved' ? 'text-[#34d399]'
    : '';
  const saveStatusText =
    saveStatus?.state === 'error' ? 'Save failed'
    : saveStatus?.state === 'saving' ? 'Saving…'
    : saveStatus?.state === 'saved' ? 'Saved'
    : '';

  if (!mounted) return null;

  if (!supported) {
    return (
      <div className="fullbleed">
        <div className="fixed inset-0 z-10 bg-canvas flex items-center justify-center">
          <div className="panel max-w-lg w-full p-8 text-center">
            <h2 className="text-xl font-bold">Quick Annotate</h2>
            <p className="text-base text-danger mt-3">
              This browser does not support the storage APIs quick annotate needs. Use a recent Chromium-based browser.
            </p>
            <button onClick={() => router.push('/')} className="mt-6 px-4 py-2">← Back</button>
          </div>
        </div>
      </div>
    );
  }

  // === Picker state — no image chosen ===
  if (!file) {
    return (
      <div className="fullbleed">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
        <div className="fixed inset-0 z-10 bg-canvas flex items-center justify-center">
          <div
            className={`w-full max-w-[440px] border bg-surface ${dragOver ? 'border-focus' : 'border-border'}`}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div className="border-b border-border px-5 py-4 text-center">
              <h2 className="m-0 text-lg font-semibold">Quick Annotate</h2>
            </div>
            <div className="p-5">
              <button onClick={() => fileInputRef.current?.click()} className="button-primary w-full py-4 text-sm font-bold">
                Choose Image…
              </button>
              {error && <div className="mt-3 text-center text-sm text-danger">{error}</div>}
              <button onClick={() => router.push('/')} className="button-quiet mt-3 w-full text-sm">
                ← Back to projects
              </button>
            </div>
          </div>
        </div>
        {msg && <div className="toast">{msg}</div>}
      </div>
    );
  }

  // === Editor state — image chosen ===
  return (
    <div className="fullbleed">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
      <div className="flex flex-col overflow-hidden" style={{ height: 'calc(100vh - var(--player-headroom))', overscrollBehavior: 'none' }}>
        {/* Navbar */}
        <div className="flex items-stretch bg-surface border-b border-border shrink-0">
          <button onClick={() => router.push('/')} className={actionBtnCls}>← Back</button>
          <button onClick={handleNewImage} className={actionBtnCls}>New Image…</button>
          <div className="self-stretch flex items-center px-3 border-0 border-r border-solid border-border text-sm text-muted truncate max-w-[320px]">
            {file.name}
          </div>
          <span className="flex-1" />
          {saveStatusText && (
            <div className={`self-stretch flex items-center px-3 border-0 border-l border-solid border-border text-sm ${saveStatusCls}`}>
              {saveStatusText}
            </div>
          )}
          <button onClick={() => void exportPng()} disabled={exporting || !imgSize} className={`${actionBtnCls} border-l font-bold`}>
            {exporting ? 'Exporting…' : 'Export PNG'}
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-stretch justify-center bg-surface border-b border-border shrink-0 flex-wrap">
          <button onClick={() => setTool('select')} aria-pressed={tool === 'select'} className={toolBtnCls('select')}>Select</button>
          <button onClick={() => setTool('box')} aria-pressed={tool === 'box'} className={toolBtnCls('box')}>Box</button>
          <button onClick={() => setTool('circle')} aria-pressed={tool === 'circle'} className={toolBtnCls('circle')}>Circle</button>
          <button onClick={() => setTool('highlight')} aria-pressed={tool === 'highlight'} className={toolBtnCls('highlight')}>Highlight</button>
          <button onClick={() => setTool('shadow')} aria-pressed={tool === 'shadow'} className={toolBtnCls('shadow')}>Shadow</button>
          <button onClick={() => setTool('arrow')} aria-pressed={tool === 'arrow'} className={toolBtnCls('arrow')}>Arrow</button>
          <button onClick={() => setTool('lob')} aria-pressed={tool === 'lob'} className={toolBtnCls('lob')}>Lob</button>
          <button onClick={() => setTool('poly')} aria-pressed={tool === 'poly'} className={toolBtnCls('poly')}>Poly</button>
          <button onClick={() => setTool('text')} aria-pressed={tool === 'text'} className={toolBtnCls('text')}>Text</button>
          <button
            onClick={() => void handleAutoCalibrate()}
            disabled={isCalibrating || !imgSize}
            className={actionBtnCls}
          >
            {isCalibrating ? 'Calibrating…' : 'Calibrate'}
          </button>
          <button onClick={() => setTool('calibrate')} aria-pressed={tool === 'calibrate'} className={toolBtnCls('calibrate')}>Manual H</button>
          {hasStroke && hasFill && (
            <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
              <span className="text-muted">Stroke</span>
              <input type="color" value={defaultColor} onChange={(e) => handleDefaultStrokeColorChange(e.target.value)} className="w-7 h-7 cursor-pointer" />
              <ColorLinkToggle linked={defaultColorsLinked} onToggle={toggleDefaultColorsLinked} />
              <span className="text-muted">Fill</span>
              <input type="color" value={defaultFill} onChange={(e) => handleDefaultFillColorChange(e.target.value)} className="w-7 h-7 cursor-pointer" />
            </div>
          )}
          {hasStroke && !hasFill && (
            <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
              <span className="text-muted">Stroke</span>
              <input type="color" value={defaultColor} onChange={(e) => handleDefaultStrokeColorChange(e.target.value)} className="w-7 h-7 cursor-pointer" />
            </div>
          )}
          {hasWidth && (
            <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
              <span className="text-muted">Width</span>
              <input type="number" min={1} max={16} step={1} value={defaultStrokeWidth} onChange={(e) => setDefaultStrokeWidth(Math.max(1, Math.min(16, Number(e.target.value) || 1)))} className="w-12" />
            </div>
          )}
          {hasPattern && (
            <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
              <span className="text-muted">Style</span>
              <select value={strokePattern} onChange={(e) => setStrokePattern((e.target.value as StrokePattern) || 'solid')}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
                <option value="dashdot">Dash-dot</option>
              </select>
            </div>
          )}
          {hasFill && (
            <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
              <span className="text-muted">Opacity</span>
              <input type="range" min={0} max={100} step={1} value={Math.round(defaultFillOpacity * 100)} onChange={(e) => setDefaultFillOpacity(Number(e.target.value) / 100)} className="w-16" />
              <span className="text-muted text-xs">{Math.round(defaultFillOpacity * 100)}%</span>
            </div>
          )}
          {hasFont && (
            <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
              <span className="text-muted">Size</span>
              <input type="number" min={1} max={300} step={1} value={defaultFontSize} onChange={(e) => setDefaultFontSize(Math.max(1, Math.min(300, Number(e.target.value) || 48)))} className="w-14" />
            </div>
          )}
          {hasFont && (
            <label className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
              <input type="checkbox" checked={defaultTextHighlight} onChange={(e) => setDefaultTextHighlight(e.target.checked)} />
              <span className="text-muted">Highlight</span>
            </label>
          )}
          <button onClick={() => applyFit('fit')} className={actionBtnCls + ' border-l'}>Fit</button>
          <button onClick={() => applyFit('actual')} className={actionBtnCls}>100%</button>
          <div className="self-stretch flex items-center px-3 text-sm text-muted">
            Zoom: {(scale * 100).toFixed(0)}%
          </div>
        </div>

        {error && <div className="shrink-0 px-3 py-1 text-xs text-danger border-b border-subtle">{error}</div>}

        {/* Canvas */}
        <div
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={`relative flex-1 min-h-0 bg-surface overflow-hidden touch-none ${panning ? 'cursor-grabbing' : 'cursor-default'}`}
          style={{ overscrollBehavior: 'none' }}
        >
          {!imgSize && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">
              Decoding image…
            </div>
          )}
          {imgUrl && imgSize && stillId && annotationFilePath && projectDir && (
            <Editor
              key={stillId}
              stillId={stillId}
              annotationId="default"
              annotationFilePath={annotationFilePath}
              annotationLabel="Quick annotations"
              imageInfo={imageInfo}
              imgUrl={imgUrl}
              stageScale={scale}
              stageOffset={offset}
              tool={tool}
              defaultStrokePattern={strokePattern}
              defaultColor={defaultColor}
              defaultStrokeWidth={defaultStrokeWidth}
              defaultFill={defaultFill}
              defaultFillOpacity={defaultFillOpacity}
              defaultFontSize={defaultFontSize}
              defaultTextHighlight={defaultTextHighlight}
              onRequestToolChange={setTool}
              saveTick={saveTick}
              onSaveStatus={onSaveStatus}
              autoPerspectiveQuad={autoPerspectiveQuad}
              autoPerspectiveTick={autoPerspectiveTick}
              projectDir={projectDir}
            />
          )}
        </div>
      </div>
      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
