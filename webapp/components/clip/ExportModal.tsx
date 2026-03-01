"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Clip, ClipAnnotation } from "../../lib/types/clip";
import { interpolateKeyframes } from "../../lib/clip/interpolation";
import {
  startExport,
  sendExportFrame,
  encodeExport,
  cleanupExport,
} from "../../lib/clip/sidecarClient";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExportModalProps {
  clip: Clip;
  annotations: ClipAnnotation[];
  videoEl: HTMLVideoElement;
  videoFps: number;
  sidecarBaseUrl: string;
  onClose: () => void;
  renderAnnotationsToCanvas: (
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    tMs: number,
  ) => void;
}

type ExportState = 'idle' | 'exporting' | 'encoding' | 'done' | 'error' | 'cancelled';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExportModal({
  clip,
  annotations,
  videoEl,
  videoFps,
  sidecarBaseUrl,
  onClose,
  renderAnnotationsToCanvas,
}: ExportModalProps) {
  const [fps, setFps] = useState(Math.min(30, videoFps));
  const [state, setState] = useState<ExportState>('idle');
  const [progress, setProgress] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const abortRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);

  const clipDurationMs = clip.endMs - clip.startMs;
  const width = videoEl.videoWidth || 1920;
  const height = videoEl.videoHeight || 1080;

  const handleExport = useCallback(async () => {
    abortRef.current = false;
    setState('exporting');
    setProgress(0);
    setErrorMsg(null);
    setOutputPath(null);

    const total = Math.max(1, Math.ceil((clipDurationMs / 1000) * fps));
    setTotalFrames(total);

    let sessionId: string | null = null;

    try {
      // 1. Start export session
      const startResult = await startExport(
        { clipId: clip.id, fps, width, height },
        sidecarBaseUrl,
      );
      sessionId = startResult.sessionId;
      sessionIdRef.current = sessionId;

      // 2. Render and send each frame
      const offscreen = document.createElement('canvas');
      offscreen.width = width;
      offscreen.height = height;
      const ctx = offscreen.getContext('2d')!;

      let consecutiveFailures = 0;

      for (let i = 0; i < total; i++) {
        if (abortRef.current) {
          setState('cancelled');
          break;
        }

        const tMs = (i / fps) * 1000; // clip-relative ms
        const absMs = clip.startMs + tMs;

        // Seek video
        videoEl.currentTime = absMs / 1000;
        await new Promise<void>((resolve) => {
          const onSeeked = () => { videoEl.removeEventListener('seeked', onSeeked); resolve(); };
          videoEl.addEventListener('seeked', onSeeked);
        });

        // Draw video frame
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(videoEl, 0, 0, width, height);

        // Draw annotations
        renderAnnotationsToCanvas(offscreen, width, height, tMs);

        // Convert to base64 JPEG
        const dataUrl = offscreen.toDataURL('image/jpeg', 0.95);

        // Send to sidecar
        try {
          await sendExportFrame(sessionId, i, dataUrl, sidecarBaseUrl);
          consecutiveFailures = 0;
        } catch (err) {
          consecutiveFailures++;
          console.warn(`Frame ${i} send failed:`, err);
          if (consecutiveFailures >= 3) {
            throw new Error(`3 consecutive frame send failures. Last: ${err}`);
          }
        }

        setProgress(i + 1);
      }

      if (abortRef.current) return;

      // 3. Encode
      setState('encoding');
      const encodeResult = await encodeExport(sessionId, fps, undefined, sidecarBaseUrl);
      setOutputPath(encodeResult.outputPath);
      setState('done');

    } catch (err: any) {
      if (!abortRef.current) {
        setErrorMsg(err?.message || String(err));
        setState('error');
      }
    } finally {
      // 4. Cleanup
      if (sessionId) {
        await cleanupExport(sessionId, sidecarBaseUrl).catch(() => {});
      }
      sessionIdRef.current = null;
    }
  }, [clip, annotations, videoEl, fps, width, height, clipDurationMs, sidecarBaseUrl, renderAnnotationsToCanvas]);

  const handleCancel = useCallback(() => {
    abortRef.current = true;
    if (sessionIdRef.current) {
      cleanupExport(sessionIdRef.current, sidecarBaseUrl).catch(() => {});
    }
    setState('cancelled');
  }, [sidecarBaseUrl]);

  // Prevent background scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const progressPct = totalFrames > 0 ? Math.round((progress / totalFrames) * 100) : 0;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && state !== 'exporting' && state !== 'encoding') onClose(); }}>
      <div className="modal-card" style={{ minWidth: 400, maxWidth: 500 }}>
        <h2 className="text-lg font-bold mb-4">Export Clip</h2>

        {/* Settings */}
        {state === 'idle' && (
          <>
            <div className="mb-3">
              <label className="text-sm text-muted block mb-1">Frame rate (fps)</label>
              <input
                type="number"
                value={fps}
                onChange={(e) => setFps(Math.max(1, Math.min(120, Number(e.target.value) || 30)))}
                min={1}
                max={120}
                step={1}
                className="w-full px-2 py-1 text-sm"
              />
            </div>
            <div className="mb-3 text-sm text-muted">
              Resolution: {width} × {height}<br />
              Duration: {(clipDurationMs / 1000).toFixed(1)}s<br />
              Frames: {Math.ceil((clipDurationMs / 1000) * fps)}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleExport}
                className="flex-1 px-4 py-2 text-sm bg-[#10b981] text-surface border-0 cursor-pointer"
              >
                Export
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm border-0 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Progress */}
        {(state === 'exporting' || state === 'encoding') && (
          <>
            <div className="mb-3">
              <div className="progress mb-2">
                <div
                  className="h-full bg-[#10b981] transition-all"
                  style={{ width: `${state === 'encoding' ? 100 : progressPct}%` }}
                />
              </div>
              <div className="text-sm text-muted">
                {state === 'encoding'
                  ? 'Encoding video...'
                  : `Rendering frame ${progress} / ${totalFrames} (${progressPct}%)`}
              </div>
            </div>
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm border-0 cursor-pointer"
            >
              Cancel
            </button>
          </>
        )}

        {/* Done */}
        {state === 'done' && (
          <>
            <div className="mb-3 text-sm">
              Export complete!
              {outputPath && (
                <div className="mt-1 text-muted break-all">{outputPath}</div>
              )}
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border-0 cursor-pointer"
            >
              Close
            </button>
          </>
        )}

        {/* Error */}
        {state === 'error' && (
          <>
            <div className="mb-3 text-sm text-red-400">
              Export failed: {errorMsg}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleExport}
                className="px-4 py-2 text-sm border-0 cursor-pointer"
              >
                Retry
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm border-0 cursor-pointer"
              >
                Close
              </button>
            </div>
          </>
        )}

        {/* Cancelled */}
        {state === 'cancelled' && (
          <>
            <div className="mb-3 text-sm text-muted">Export cancelled.</div>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border-0 cursor-pointer"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
