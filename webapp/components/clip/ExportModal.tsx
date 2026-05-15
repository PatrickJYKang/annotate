"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Clip, ClipAnnotation } from "../../lib/types/clip";
import { interpolateKeyframes } from "../../lib/clip/interpolation";
import {
  startExport,
  sendExportFrame,
  encodeExport,
  downloadExportFile,
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
  projectDir?: FileSystemDirectoryHandle;
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
  projectDir,
  onClose,
  renderAnnotationsToCanvas,
}: ExportModalProps) {
  const [fps, setFps] = useState(videoFps > 0 ? videoFps : 30);
  const [state, setState] = useState<ExportState>('idle');
  const [progress, setProgress] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const abortRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const playbackSnapshotRef = useRef<{ time: number; wasPaused: boolean } | null>(null);

  const clipDurationMs = clip.endMs - clip.startMs;
  const width = videoEl.videoWidth || 1920;
  const height = videoEl.videoHeight || 1080;

  const buildExportFileName = useCallback(() => {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const safeClipId = clip.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'clip';
    return `clip_${safeClipId}_${stamp}.mp4`;
  }, [clip.id]);

  const writeExportToProject = useCallback(async (blob: Blob) => {
    if (!projectDir) {
      throw new Error('Project folder handle unavailable. Reopen the project folder before exporting.');
    }

    const fileName = buildExportFileName();
    const exportsDir = await projectDir.getDirectoryHandle('exports', { create: true });
    const fileHandle = await exportsDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
    return `exports/${fileName}`;
  }, [buildExportFileName, projectDir]);

  const handleExport = useCallback(async () => {
    abortRef.current = false;
    setState('exporting');
    setProgress(0);
    setErrorMsg(null);
    setOutputPath(null);

    playbackSnapshotRef.current = {
      time: videoEl.currentTime,
      wasPaused: videoEl.paused,
    };
    if (!videoEl.paused) {
      videoEl.pause();
    }

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
      await encodeExport(sessionId, fps, undefined, sidecarBaseUrl);
      const exportedVideo = await downloadExportFile(sessionId, sidecarBaseUrl);
      const projectOutputPath = await writeExportToProject(exportedVideo);
      setOutputPath(projectOutputPath);
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

      const snap = playbackSnapshotRef.current;
      playbackSnapshotRef.current = null;
      if (snap) {
        try {
          videoEl.currentTime = snap.time;
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              videoEl.removeEventListener('seeked', onSeeked);
              resolve();
            };
            const onSeeked = () => finish();
            videoEl.addEventListener('seeked', onSeeked);
            window.setTimeout(finish, 200);
          });
          if (!snap.wasPaused) {
            await videoEl.play().catch(() => {});
          }
        } catch {
          // ignore restore failures
        }
      }
    }
  }, [clip, videoEl, fps, width, height, clipDurationMs, sidecarBaseUrl, renderAnnotationsToCanvas, writeExportToProject]);

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
              Frames: {Math.ceil((clipDurationMs / 1000) * fps)}<br />
              Output: project folder / exports/
            </div>
            {!projectDir && (
              <div className="mb-3 text-sm text-red-400">
                Project folder handle unavailable. Reopen the project before exporting.
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleExport}
                disabled={!projectDir}
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
