"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useProject } from "../../../lib/state/ProjectContext";
import { validateProjectFolderStructure } from "../../../lib/fs/projectFolder";
import { readClip, resolveMarkPinning } from "../../../lib/fs/clipStorage";
import { getProjectFps } from "../../../lib/types/project";
import type { Clip } from "../../../lib/types/clip";
import type { ClipTool } from "../../../components/clip/ClipEditor";
import { SidecarProvider } from "../../../lib/state/SidecarContext";
import { registerVideoFile, unregisterVideoRef } from "../../../lib/clip/sidecarClient";

const ClipEditor = dynamic(() => import("../../../components/clip/ClipEditor"), { ssr: false });

const TOOL_OPTIONS: Array<{ id: ClipTool; label: string; hint: string }> = [
  { id: 'select', label: 'Select', hint: 'Pause to select and drag existing annotations.' },
  { id: 'box', label: 'Box', hint: 'Drag out a box or click for a default-sized one.' },
  { id: 'circle', label: 'Circle', hint: 'Drag to size a circle or click for a default-sized one.' },
  { id: 'shadow', label: 'Shadow', hint: 'Drag out a cover shadow wedge from the player or area of interest.' },
  { id: 'arrow', label: 'Arrow', hint: 'Click once for the start point and again for the end point.' },
  { id: 'lob', label: 'Lob', hint: 'Click once for the start point and again for the end point to place a curved pass.' },
  { id: 'poly', label: 'Poly', hint: 'Click to place points, click the first point to close, or press Enter to finish.' },
  { id: 'text', label: 'Text', hint: 'Click to drop a text label at the current frame.' },
  { id: 'highlight', label: 'Highlight', hint: 'Click to add a player highlight at the current frame.' },
];

export default function ClipPage({ params }: { params: { clipId: string } }) {
  const { clipId } = params;
  const { projectDir, setProjectDir, manifest, setManifest } = useProject();

  const [clip, setClip] = useState<Clip | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- Tool & style state ---
  const [tool, setTool] = useState<ClipTool>('select');
  const [defaultColor, setDefaultColor] = useState('#000000');
  const [defaultStrokeWidth, setDefaultStrokeWidth] = useState(6);
  const [sidecarVideoRef, setSidecarVideoRef] = useState<string | null>(null);
  const [sidecarVideoError, setSidecarVideoError] = useState<string | null>(null);
  const activeSidecarVideoRef = useRef<string | null>(null);

  // --- IndexedDB handle persistence (same pattern as annotate page) ---

  const openDB = useCallback((): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('annotate-db', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }, []);

  const saveProjectHandle = useCallback(async (handle: FileSystemDirectoryHandle) => {
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle as any, 'project');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { const err = tx.error; db.close(); reject(err); };
      });
    } catch {
      // ignore persistence errors
    }
  }, [openDB]);

  const loadProjectHandle = useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
    try {
      const db = await openDB();
      const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('project');
        req.onsuccess = () => { const v = req.result as FileSystemDirectoryHandle | undefined; db.close(); resolve(v || null); };
        req.onerror = () => { const err = req.error; db.close(); reject(err); };
      });
      return handle;
    } catch {
      return null;
    }
  }, [openDB]);

  // Auto-restore project handle from IndexedDB on mount
  useEffect(() => {
    (async () => {
      if (projectDir || manifest) return;
      try {
        const handle = await loadProjectHandle();
        if (!handle) return;
        const anyHandle: any = handle as any;
        const q = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'read' }) : 'granted');
        if (q !== 'granted') return;
        const v = await validateProjectFolderStructure(handle);
        if (v.ok) {
          setProjectDir(handle);
          setManifest(v.manifest);
        }
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
  }, [projectDir, manifest, loadProjectHandle, setProjectDir, setManifest]);

  // Listen for project handle from opener (postMessage)
  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as any;
      if (data && data.type === 'project-handle' && data.handle) {
        try {
          const handle: FileSystemDirectoryHandle = data.handle as FileSystemDirectoryHandle;
          await saveProjectHandle(handle);
          const anyHandle: any = handle as any;
          const q = await (anyHandle.queryPermission ? anyHandle.queryPermission({ mode: 'read' }) : 'granted');
          if (q !== 'granted') return;
          const v = await validateProjectFolderStructure(handle);
          if (!v.ok) throw new Error(`Not a valid project folder: ${v.reason}`);
          setProjectDir(handle);
          setManifest(v.manifest);
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [setProjectDir, setManifest, saveProjectHandle]);

  // --- Load clip ---
  useEffect(() => {
    (async () => {
      if (!projectDir || !manifest) return;
      try {
        const raw = await readClip(projectDir, clipId);
        if (!raw) { setError(`Clip not found: ${clipId}`); return; }
        const resolved = resolveMarkPinning(raw, manifest.marks);
        setClip(resolved);
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
  }, [projectDir, manifest, clipId]);

  // --- Resolve video URL ---
  const getFileForPath = useCallback(async (dir: FileSystemDirectoryHandle, path: string) => {
    const parts = path.split('/').filter(Boolean);
    let cur: FileSystemDirectoryHandle = dir;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = await cur.getDirectoryHandle(parts[i], { create: false });
    }
    const fh = await cur.getFileHandle(parts[parts.length - 1], { create: false });
    return await fh.getFile();
  }, []);

  const getFileUrlForPath = useCallback(async (dir: FileSystemDirectoryHandle, path: string) => {
    const file = await getFileForPath(dir, path);
    return URL.createObjectURL(file);
  }, [getFileForPath]);

  const clipVideoId = clip?.videoId;

  useEffect(() => {
    let revoked: string | null = null;
    (async () => {
      if (!projectDir || !manifest || !clipVideoId) return;
      const video = manifest.videos.find(v => v.id === clipVideoId);
      if (!video) { setError(`Video not found for clip (videoId: ${clipVideoId})`); return; }
      try {
        const url = await getFileUrlForPath(projectDir, video.file);
        revoked = url;
        setVideoUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [projectDir, manifest, clipVideoId, getFileUrlForPath]);

  const videoFps = useMemo(() => {
    if (!manifest || !clip) return 30;
    return getProjectFps(manifest);
  }, [manifest, clip]);

  const videoPath = useMemo(() => {
    if (!manifest || !clip) return undefined;
    return manifest.videos.find(v => v.id === clip.videoId)?.file;
  }, [manifest, clip]);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!projectDir || !videoPath) {
        const prev = activeSidecarVideoRef.current;
        activeSidecarVideoRef.current = null;
        if (prev) {
          await unregisterVideoRef(prev).catch(() => {});
        }
        setSidecarVideoRef(null);
        setSidecarVideoError(null);
        return;
      }
      try {
        const file = await getFileForPath(projectDir, videoPath);
        const reg = await registerVideoFile(file);

        if (!active) {
          await unregisterVideoRef(reg.videoRef).catch(() => {});
          return;
        }

        const prev = activeSidecarVideoRef.current;
        activeSidecarVideoRef.current = reg.videoRef;
        setSidecarVideoRef(reg.videoRef);
        setSidecarVideoError(null);
        if (prev && prev !== reg.videoRef) {
          await unregisterVideoRef(prev).catch(() => {});
        }
      } catch (e: any) {
        if (!active) return;
        const prev = activeSidecarVideoRef.current;
        activeSidecarVideoRef.current = null;
        if (prev) {
          await unregisterVideoRef(prev).catch(() => {});
        }
        setSidecarVideoRef(null);
        setSidecarVideoError(e?.message || 'Failed to register video with sidecar');
      }
    })();

    return () => {
      active = false;
    };
  }, [projectDir, videoPath, getFileForPath]);

  useEffect(() => {
    return () => {
      const ref = activeSidecarVideoRef.current;
      if (ref) {
        void unregisterVideoRef(ref).catch(() => {});
        activeSidecarVideoRef.current = null;
      }
    };
  }, []);

  const formatTimeNoMs = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.floor(ms || 0));
    let r = clamped;
    const hh = Math.floor(r / 3600000); r %= 3600000;
    const mm = Math.floor(r / 60000); r %= 60000;
    const ss = Math.floor(r / 1000);
    return hh > 0 ? `${hh}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${mm}:${String(ss).padStart(2,'0')}`;
  }, []);
  const activeToolMeta = TOOL_OPTIONS.find((entry) => entry.id === tool) || TOOL_OPTIONS[0];

  // --- Open project folder (fallback) ---
  const openProject = useCallback(async () => {
    try {
      const dir: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker();
      const anyHandle: any = dir as any;
      const q = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'readwrite' }) : 'granted');
      if (q !== 'granted' && anyHandle?.requestPermission) {
        const r = await anyHandle.requestPermission({ mode: 'readwrite' });
        if (r !== 'granted') throw new Error('Write permission not granted');
      }
      await saveProjectHandle(dir);
      const v = await validateProjectFolderStructure(dir);
      if (!v.ok) throw new Error(`Not a valid project folder: ${v.reason}`);
      setProjectDir(dir);
      setManifest(v.manifest);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, [setProjectDir, setManifest, saveProjectHandle]);

  // --- Render ---

  if (!projectDir) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">No project open. If you opened this page from Stills, it will auto-connect. Otherwise, open your project folder.</div>
          <div className="toolbar mt-2">
            <button onClick={openProject}>Open Project Folder</button>
          </div>
        </div>
      </div>
    );
  }
  if (!manifest) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">Loading project...</div>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status text-danger">{error}</div>
          <div className="toolbar mt-2">
            <button onClick={openProject}>Open Project Folder</button>
          </div>
        </div>
      </div>
    );
  }
  if (!clip) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">Loading clip...</div>
        </div>
      </div>
    );
  }

  return (
    <SidecarProvider>
      <div className="fullbleed flex flex-1 min-h-0 flex-col">
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {/* Navbar */}
          <div className="flex items-stretch bg-surface border-b border-border shrink-0">
            <button
              onClick={() => window.close()}
              className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base"
            >
              Close
            </button>
            <div className="self-stretch flex items-center px-3 text-sm text-muted">
              Clip: {formatTimeNoMs(clip.startMs)} – {formatTimeNoMs(clip.endMs)}
              {clip.annotations.length > 0 && ` · ${clip.annotations.length} annotations`}
            </div>
            <span className="flex-1" />
            {sidecarVideoError && (
              <div className="self-stretch flex items-center px-2 text-xs text-red-400 border-0 border-l border-solid border-border max-w-[18rem] truncate" title={sidecarVideoError}>
                {sidecarVideoError}
              </div>
            )}
            <div className="self-stretch flex items-center px-3 text-sm text-muted border-0 border-l border-solid border-border">
              {videoFps}fps
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-stretch justify-center bg-surface border-b border-border shrink-0">
            {TOOL_OPTIONS.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setTool(entry.id)}
                aria-pressed={tool === entry.id}
                title={entry.hint}
                className={`self-stretch min-w-[5.5rem] px-3 py-1.5 border-0 border-r border-solid border-border text-sm cursor-pointer ${
                  tool === entry.id ? 'bg-white/15 font-bold' : ''
                }`}
              >
                {entry.label}
              </button>
            ))}
            <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-r border-solid border-border text-sm">
              <span className="text-muted">Stroke</span>
              <input type="color" value={defaultColor} onChange={e => setDefaultColor(e.target.value || '#000000')} className="w-7 h-7 cursor-pointer" />
            </div>
            <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-r border-solid border-border text-sm">
              <span className="text-muted">Width</span>
              <input
                type="number"
                min={1}
                max={16}
                step={1}
                value={defaultStrokeWidth}
                onChange={e => setDefaultStrokeWidth(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
                className="w-12"
              />
            </div>
            <div className="self-stretch flex items-center px-3 text-xs text-muted max-w-[20rem]">
              <span className="font-medium mr-1">{activeToolMeta.label}:</span>
              <span>{activeToolMeta.hint}</span>
            </div>
          </div>

          {/* ClipEditor */}
          {videoUrl ? (
            <ClipEditor
              clip={clip}
              videoUrl={videoUrl}
              videoFps={videoFps}
              projectDir={projectDir ?? undefined}
              manifest={manifest}
              videoRef={sidecarVideoRef ?? undefined}
              videoPath={videoPath}
              tool={tool}
              defaultColor={defaultColor}
              defaultStrokeWidth={defaultStrokeWidth}
            />
          ) : (
            <div className="flex-1 min-h-0 flex items-center justify-center bg-surface">
              <div className="text-muted text-sm">Loading video...</div>
            </div>
          )}
        </div>
      </div>
    </SidecarProvider>
  );
}
