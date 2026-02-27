"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "../../lib/state/ProjectContext";
import type { ProjectManifestV1 } from "../../lib/types/project";
import { readManifest, reindexAnnotations, writeManifest } from "../../lib/fs/projectFolder";
import { exportD7All } from "../../lib/export/d7Export";
import VideoPlayerUnit, { VideoPlayerHandle } from "../../components/player/VideoPlayerUnit";

function pad6(n: number) { return n.toString().padStart(6, "0"); }

export default function StillsPage() {
  const router = useRouter();
  const { projectDir, manifest, setManifest, selectedVideoId } = useProject();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [seekMs, setSeekMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number; message: string } | null>(null);
  const [exportFailures, setExportFailures] = useState<{ stillId: string; error: string }[] | null>(null);
  const [exportCompleted, setExportCompleted] = useState(false);

  const marksForVideo = useMemo(() => {
    if (!manifest || !selectedVideoId) return [] as ProjectManifestV1["marks"];
    return manifest.marks.filter(m => m.videoId === selectedVideoId).sort((a, b) => a.t_ms - b.t_ms);
  }, [manifest, selectedVideoId]);

  const videoFps = useMemo(() => (manifest?.videos.find(v => v.id === selectedVideoId)?.fps) || 30, [manifest, selectedVideoId]);

  const formatTimeNoMs = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.floor(ms || 0));
    let r = clamped;
    const hh = Math.floor(r / 3600000); r %= 3600000;
    const mm = Math.floor(r / 60000); r %= 60000;
    const ss = Math.floor(r / 1000);
    return hh > 0 ? `${hh}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${mm}:${String(ss).padStart(2,'0')}`;
  }, []);

  const getFileUrlForPath = useCallback(async (dir: FileSystemDirectoryHandle, path: string) => {
    const parts = path.split('/').filter(Boolean);
    let cur: FileSystemDirectoryHandle = dir;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = await cur.getDirectoryHandle(parts[i], { create: false });
    }
    const fh = await cur.getFileHandle(parts[parts.length - 1], { create: false });
    const file = await fh.getFile();
    return URL.createObjectURL(file);
  }, []);

  const baseName = (p: string) => (p.split('/').pop() || p);

  const [thumbs, setThumbs] = useState<{ id: string; url: string; t_ms: number; file: string }[]>([]);
  const [hoveredThumbId, setHoveredThumbId] = useState<string | null>(null);

  const syncAnnotationIndex = useCallback(async () => {
    if (!projectDir) return;
    try {
      const latest = await readManifest(projectDir);
      if (!latest) return;
      const next = await reindexAnnotations(projectDir, latest);
      const a0 = JSON.stringify(latest.annotations || []);
      const a1 = JSON.stringify(next.annotations || []);
      if (a0 !== a1) {
        await writeManifest(projectDir, next);
        setManifest(next);
      } else {
        if (!manifest) setManifest(latest);
      }
    } catch {
      // ignore
    }
  }, [projectDir, manifest, setManifest]);

  useEffect(() => {
    if (!projectDir) return;
    void syncAnnotationIndex();
  }, [projectDir, syncAnnotationIndex]);

  useEffect(() => {
    if (!projectDir) return;
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('annotate-events');
      bc.onmessage = (ev: MessageEvent) => {
        const data = (ev as any).data as any;
        if (data && data.type === 'annotation-saved') {
          void syncAnnotationIndex();
        }
      };
    } catch {
      bc = null;
    }
    return () => {
      try { if (bc) bc.close(); } catch {}
    };
  }, [projectDir, syncAnnotationIndex]);

  useEffect(() => {
    let revoked: string[] = [];
    (async () => {
      if (!projectDir || !manifest || !selectedVideoId) { setThumbs([]); return; }
      const list = manifest.stills
        .filter(s => s.videoId === selectedVideoId)
        .sort((a,b) => a.t_ms - b.t_ms);
      const urls: { id: string; url: string; t_ms: number; file: string }[] = [];
      for (const s of list) {
        const thumbPath = `thumbnails/${baseName(s.file)}`;
        try {
          const url = await getFileUrlForPath(projectDir, thumbPath);
          urls.push({ id: s.id, url, t_ms: s.t_ms, file: s.file });
          revoked.push(url);
        } catch (err) {
          // ignore missing thumbs
        }
      }
      setThumbs(urls);
    })();
    return () => { revoked.forEach(u => URL.revokeObjectURL(u)); };
  }, [projectDir, manifest, selectedVideoId, getFileUrlForPath]);

  const loadVideoUrl = useCallback(async (mf: ProjectManifestV1, dir: FileSystemDirectoryHandle, videoId: string) => {
    const v = mf.videos.find(x => x.id === videoId);
    if (!v) return null;
    const parts = v.file.split("/").filter(Boolean);
    let cur: FileSystemDirectoryHandle = dir;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = await cur.getDirectoryHandle(parts[i], { create: false });
    }
    const fh = await cur.getFileHandle(parts[parts.length - 1], { create: false });
    const file = await fh.getFile();
    return URL.createObjectURL(file);
  }, []);

  useEffect(() => {
    let revoked: string | null = null;
    (async () => {
      if (!projectDir || !manifest || !selectedVideoId) return;
      const url = await loadVideoUrl(manifest, projectDir, selectedVideoId);
      if (!url) return;
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      revoked = url;
      setVideoUrl(url);
    })();
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [projectDir, selectedVideoId]);

  

  const captureToBlob = useCallback(async (v: HTMLVideoElement) => {
    const w = v.videoWidth;
    const h = v.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not available");
    ctx.drawImage(v, 0, 0, w, h);
    const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("PNG encode failed")), 'image/png'));
    return { blob, w, h };
  }, []);

  const createThumbnailBlob = useCallback(async (srcBlob: Blob, maxWidth = 400) => {
    const img = new Image();
    const url = URL.createObjectURL(srcBlob);
    try {
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("thumb load failed")); img.src = url; });
      const scale = maxWidth / img.width;
      const tw = Math.round(img.width * scale);
      const th = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = tw; canvas.height = th;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D not available");
      ctx.drawImage(img, 0, 0, tw, th);
      const thumbBlob: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("PNG encode failed")), 'image/png'));
      return { thumbBlob, tw, th };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, []);

  const nextStillNumber = useCallback(() => {
    // Find max used 6-digit number in existing still filenames
    const re = /(\d{6})\.png$/i;
    let max = 0;
    for (const s of (manifest?.stills || [])) {
      const m = s.file.match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
  }, [manifest]);

  const writeBlobToFile = useCallback(async (dir: FileSystemDirectoryHandle, subdir: string, fileName: string, blob: Blob) => {
    const targetDir = await dir.getDirectoryHandle(subdir, { create: true });
    const fh = await targetDir.getFileHandle(fileName, { create: true });
    const ws = await fh.createWritable();
    await ws.write(blob);
    await ws.close();
    return `${subdir}/${fileName}`;
  }, []);

  const deleteFileAtPath = useCallback(async (dir: FileSystemDirectoryHandle, path: string) => {
    const parts = path.split('/').filter(Boolean);
    const name = parts[parts.length - 1];
    const subdirs = parts.slice(0, -1);
    let cur: FileSystemDirectoryHandle = dir;
    for (const p of subdirs) {
      cur = await cur.getDirectoryHandle(p, { create: false });
    }
    try { await (cur as any).removeEntry(name); } catch {}
  }, []);

  const deleteStill = useCallback(async (stillId: string) => {
    if (!manifest || !projectDir) return;
    const s = (manifest.stills || []).find(x => x.id === stillId);
    if (!s) return;
    const stillPath = s.file;
    const thumbPath = `thumbnails/${baseName(stillPath)}`;
    const annPath = `annotations/${stillId}.json`;
    const next: ProjectManifestV1 = {
      ...(manifest as ProjectManifestV1),
      stills: (manifest.stills || []).filter(x => x.id !== stillId),
      thumbnails: (manifest.thumbnails || []).filter(t => t !== thumbPath),
      annotations: (manifest.annotations || []).filter(a => a.stillId !== stillId),
    };
    await writeManifest(projectDir, next);
    setManifest(next);
    try { await deleteFileAtPath(projectDir, stillPath); } catch {}
    try { await deleteFileAtPath(projectDir, thumbPath); } catch {}
    try { await deleteFileAtPath(projectDir, annPath); } catch {}
    setThumbs(prev => {
      const found = prev.find(t => t.id === stillId);
      if (found) URL.revokeObjectURL(found.url);
      return prev.filter(t => t.id !== stillId);
    });
  }, [manifest, projectDir, setManifest, deleteFileAtPath]);

  

  

  const generateHere = useCallback(async () => {
    if (!projectDir || !manifest || !selectedVideoId) return;
    const api = playerRef.current; if (!api) return;
    const v = api.getVideoElement(); if (!v) return;
    setBusy(true); setError(null);
    try {
      if (!Number.isFinite(v.duration) || v.videoWidth === 0) {
        await new Promise<void>(res => { const onLoaded = () => { v.removeEventListener('loadedmetadata', onLoaded); res(); }; v.addEventListener('loadedmetadata', onLoaded); if (v.readyState >= 1) res(); });
      }
      const t_ms = Math.round(api.getCurrentTimeMs());
      const base: ProjectManifestV1 = manifest as ProjectManifestV1;
      // dedup within ±2 frames
      const tolMs = Math.round((1000 / (videoFps || 30)) * 2);
      const dup = base.stills.some(s => s.videoId === selectedVideoId && Math.abs(s.t_ms - t_ms) <= tolMs);
      if (dup) { setToast('A still already exists near this time (skipped).'); return; }
      const { blob, w, h } = await captureToBlob(v);
      const num = nextStillNumber();
      const baseFile = `${pad6(num)}.png`;
      const stillPath = await writeBlobToFile(projectDir, 'stills', baseFile, blob);
      const baseNameOnly = stillPath.split('/').pop() || '000001.png';
      const { thumbBlob } = await createThumbnailBlob(blob, 400);
      const thumbPath = await writeBlobToFile(projectDir, 'thumbnails', baseNameOnly, thumbBlob);
      const mf: ProjectManifestV1 = {
        ...base,
        stills: [...base.stills, { id: (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? (globalThis.crypto as any).randomUUID() : `still_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, videoId: selectedVideoId, t_ms, file: stillPath, width: w, height: h }],
        thumbnails: base.thumbnails.includes(thumbPath) ? base.thumbnails : [...base.thumbnails, thumbPath],
      };
      await writeManifest(projectDir, mf);
      setManifest(mf);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [projectDir, manifest, selectedVideoId, playerRef, captureToBlob, createThumbnailBlob, nextStillNumber, writeBlobToFile, setManifest, videoFps]);

  const exportAll = useCallback(async () => {
    if (!projectDir || !manifest) return;
    setExportBusy(true);
    setExportFailures(null);
    setExportCompleted(false);
    setError(null);
    try {
      const res = await exportD7All({
        projectDir,
        manifest,
        onProgress: (p) => setExportProgress(p),
      });
      setManifest(res.manifest);
      setExportCompleted(true);
      if (res.failures.length) {
        setExportFailures(res.failures);
      } else {
        setToast('Export complete');
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setExportBusy(false);
      window.setTimeout(() => setExportProgress(null), 1200);
    }
  }, [projectDir, manifest, setManifest]);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target.tagName))) return;
      const key = e.key;
      const meta = e.metaKey;
      const shift = e.shiftKey;
      const api = playerRef.current;
      if (!api) return;
      if (meta && key === 'ArrowLeft') {
        e.preventDefault();
        const now = api.getCurrentTimeMs();
        const prev = [...marksForVideo].filter(m => m.t_ms < now).sort((a,b) => b.t_ms - a.t_ms)[0];
        if (prev) { setSelectedMarkId(prev.id); setSeekMs(prev.t_ms); }
        return;
      }
      if (meta && key === 'ArrowRight') {
        e.preventDefault();
        const now = api.getCurrentTimeMs();
        const next = [...marksForVideo].filter(m => m.t_ms > now).sort((a,b) => a.t_ms - b.t_ms)[0];
        if (next) { setSelectedMarkId(next.id); setSeekMs(next.t_ms); }
        return;
      }

      // Global non-meta hotkeys mirrored from Player page
      if (key === ' ' || key === 'Spacebar' || key === 'Space') { e.preventDefault(); await api.playPause(); return; }
      if (key === 'k' || key === 'K') { e.preventDefault(); await api.playPause(); return; }
      if (key === 'j' || key === 'J' || key === ',') { e.preventDefault(); shift ? api.nudgeLarge(-1) : api.stepFrame(-1); return; }
      if (key === 'l' || key === 'L' || key === '.') { e.preventDefault(); shift ? api.nudgeLarge(1) : api.stepFrame(1); return; }
      if (key === 'ArrowLeft') { e.preventDefault(); shift ? api.nudgeLarge(-1) : api.nudgeSmall(-1); return; }
      if (key === 'ArrowRight') { e.preventDefault(); shift ? api.nudgeLarge(1) : api.nudgeSmall(1); return; }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [marksForVideo]);

  if (!projectDir || !manifest) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">No project open. Go back and open a project.</div>
          <div className="toolbar mt-2">
            <button onClick={() => router.push('/')}>Back to Home</button>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedVideoId) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">No video selected. Choose a video from the project home.</div>
          <div className="toolbar mt-2">
            <button onClick={() => router.push('/')}>Back to Home</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fullbleed">
      <div className="panel flex flex-col overflow-hidden" style={{ height: 'calc(100vh - var(--player-headroom) + 8px)' }}>
        <div className="toolbar flex justify-between items-center">
          <strong>Stills + Thumbnails</strong>
          <div className="flex gap-2">
            <button onClick={generateHere} disabled={busy}>Generate still here</button>
            <button onClick={exportAll} disabled={exportBusy || busy} title="Export annotated PNGs + reports to reports/">
              {exportBusy ? 'Exporting…' : 'Export All'}
            </button>
            <button onClick={() => router.push('/player')}>Back to Player</button>
          </div>
        </div>

        {toast && <div className="status text-warning">{toast}</div>}
        {error && <div className="status text-danger">{error}</div>}
        {exportProgress && (
          <div className="status text-info">
            {exportProgress.message}
          </div>
        )}
        {exportFailures && exportFailures.length > 0 && (
          <div className="status text-danger">
            Export finished with {exportFailures.length} failures. See console for details.
            {(() => {
              try { console.error('D7 export failures', exportFailures); } catch {}
              return null;
            })()}
          </div>
        )}

        <div className="mt-3 flex gap-4 items-start flex-1 min-h-0">
          <div className="flex-[1_1_50%] max-w-[50%] min-w-[360px] h-full">
            <VideoPlayerUnit
              ref={playerRef}
              src={videoUrl}
              fps={videoFps}
              marks={marksForVideo.map(m => ({ id: m.id, t_ms: m.t_ms, tags: m.tags }))}
              selectedMarkId={selectedMarkId}
              onSelectMark={(id: string, t_ms: number) => { setSelectedMarkId(id); setSeekMs(t_ms); }}
              externalSeekMs={seekMs}
              hotkeys={false}
              showAddMarkButton={false}
              enableMarkHotkey={false}
              style={{ height: '100%' }}
              videoHeight="100%"
              allowFullscreen
            />
          </div>
          <div className="flex-[1_1_50%] min-w-[320px] h-full overflow-y-auto">
            <strong>Stills ({thumbs.length})</strong>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 mt-2">
              {thumbs.map(t => (
                <div
                  key={t.id}
                  className="panel relative p-1.5"
                  onMouseEnter={() => setHoveredThumbId(t.id)}
                  onMouseLeave={() => setHoveredThumbId(prev => (prev === t.id ? null : prev))}
                >
                  <button
                    onClick={() => {
                      const w = window.open(`/annotate/${t.id}`, '_blank');
                      if (w && projectDir) {
                        const origin = window.location.origin;
                        let attempts = 0;
                        const iv = window.setInterval(() => {
                          try {
                            w.postMessage({ type: 'project-handle', handle: projectDir }, origin);
                            attempts++;
                            if (attempts >= 5) window.clearInterval(iv);
                          } catch {}
                        }, 200);
                      }
                    }}
                    title="Annotate"
                    className={`absolute top-1.5 right-[76px] transition-opacity duration-[120ms] ease bg-raised text-white border border-border px-2 py-1 cursor-pointer ${hoveredThumbId === t.id ? 'opacity-100' : 'opacity-0'}`}
                  >
                    Annotate
                  </button>
                  <button
                    onClick={() => deleteStill(t.id)}
                    title="Delete still"
                    className={`absolute top-1.5 right-1.5 transition-opacity duration-[120ms] ease bg-[#991b1b] text-white border border-danger px-2 py-1 cursor-pointer ${hoveredThumbId === t.id ? 'opacity-100' : 'opacity-0'}`}
                  >
                    Delete
                  </button>
                  <img src={t.url} alt="thumb" className="w-full block" />
                  <div className="status">{formatTimeNoMs(t.t_ms)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
