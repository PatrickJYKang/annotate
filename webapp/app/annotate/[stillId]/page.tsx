"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { Tool, StrokePattern } from "../../../components/annotate/Editor";
import { useProject } from "../../../lib/state/ProjectContext";
import { readManifest, validateProjectFolderStructure } from "../../../lib/fs/projectFolder";

export default function AnnotatePage({ params }: { params: { stillId: string } }) {
  const { stillId } = params;
  const { projectDir, setProjectDir, manifest, setManifest } = useProject();

  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [strokePattern, setStrokePattern] = useState<StrokePattern>('solid');
  const [defaultColor, setDefaultColor] = useState<string>('#000000');
  const [enableForegroundOcclusion, setEnableForegroundOcclusion] = useState(false);
  const [occlusionMethod, setOcclusionMethod] = useState<'edge' | 'ml'>('edge');
  const [saveTick, setSaveTick] = useState(0);
  const [saveStatus, setSaveStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'error'; at?: string; message?: string } | null>(null);
  const [writePermission, setWritePermission] = useState<'granted' | 'denied' | 'prompt' | null>(null);

  useEffect(() => {
    if (!saveStatus) return;
    if (saveStatus.state === 'saving' || saveStatus.state === 'error') return;
    const ms = saveStatus.message === 'already_saved' ? 1000 : 1200;
    const t = window.setTimeout(() => setSaveStatus(null), ms);
    return () => window.clearTimeout(t);
  }, [saveStatus]);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const offsetStartRef = useRef<{ x: number; y: number } | null>(null);

  const still = useMemo(() => {
    if (!manifest) return null;
    return (manifest.stills || []).find(s => s.id === stillId) || null;
  }, [manifest, stillId]);

  const Editor = useMemo(() => dynamic(() => import("../../../components/annotate/Editor"), { ssr: false }), []);

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

  // Persist and restore the chosen project directory handle using IndexedDB
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

  // Attempt to auto-restore a previously opened project folder on mount
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

  useEffect(() => {
    (async () => {
      if (!projectDir) { setWritePermission(null); return; }
      try {
        const anyHandle: any = projectDir as any;
        const q = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'readwrite' }) : 'granted');
        setWritePermission(q);
      } catch {
        setWritePermission(null);
      }
    })();
  }, [projectDir]);

  const imageInfo = useMemo(() => ({
    file: still?.file || "",
    width: still?.width || imgSize?.w || 0,
    height: still?.height || imgSize?.h || 0,
  }), [still, imgSize]);

  useEffect(() => {
    (async () => {
      if (!projectDir || !still) return;
      try {
        const anyHandle: any = projectDir as any;
        const q = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'read' }) : 'granted');
        if (q !== 'granted') { setError('Folder permission not granted'); return; }
        const url = await getFileUrlForPath(projectDir, still.file);
        const w = still.width || 0;
        const h = still.height || 0;
        setImgSize({ w, h });
        setImgUrl(url);
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
  }, [projectDir, still?.file, still?.width, still?.height, getFileUrlForPath]);

  // Revoke previous object URL when imgUrl changes (prevents revoking the current one too early)
  useEffect(() => {
    return () => { if (imgUrl) URL.revokeObjectURL(imgUrl); };
  }, [imgUrl]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Lock page scrolling while this page is open
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement as HTMLElement;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverscroll = (body.style as any).overscrollBehavior;
    const prevHtmlOverscroll = (html.style as any).overscrollBehavior;
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    (body.style as any).overscrollBehavior = 'none';
    (html.style as any).overscrollBehavior = 'none';
    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      if (prevBodyOverscroll) (body.style as any).overscrollBehavior = prevBodyOverscroll; else body.style.removeProperty('overscroll-behavior');
      if (prevHtmlOverscroll) (html.style as any).overscrollBehavior = prevHtmlOverscroll; else html.style.removeProperty('overscroll-behavior');
    };
  }, []);

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
  }, [setProjectDir, setManifest]);

  const requestWriteAccess = useCallback(async () => {
    if (!projectDir) return;
    try {
      const anyHandle: any = projectDir as any;
      if (!anyHandle?.requestPermission) return;
      const r = await anyHandle.requestPermission({ mode: 'readwrite' });
      setWritePermission(r);
      if (r !== 'granted') {
        setError('Write permission not granted');
        return;
      }
      const mf = await readManifest(projectDir);
      if (mf) setManifest(mf);
      setError(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, [projectDir, setManifest]);

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
        } catch (err) {
          // ignore
        }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [setProjectDir, setManifest]);

  // Keep latest values in refs for non-passive wheel listener
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  // Attach non-passive wheel listener on document; only handle when over container
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
      const nx = cx - contentX * next;
      const ny = cy - contentY * next;
      setScale(next);
      setOffset({ x: nx, y: ny });
    };
    document.addEventListener('wheel', onWheelNative, { passive: false });
    return () => document.removeEventListener('wheel', onWheelNative);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Middle mouse button for pan
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

  const toolBtnCls = (t: Tool) =>
    `px-2 py-1 cursor-pointer text-white border ${
      tool === t
        ? 'bg-[#2563eb] border-[#60a5fa]'
        : 'bg-surface border-border'
    }`;

  const saveStatusCls =
    saveStatus?.state === 'error' ? 'text-danger'
    : saveStatus?.state === 'saving' ? 'text-warning'
    : saveStatus?.state === 'saved' ? 'text-[#34d399]'
    : '';

  const toolbar = (
    <div className="toolbar flex items-center gap-2">
      <strong>Annotate</strong>
      {writePermission && writePermission !== 'granted' && (
        <button
          onClick={requestWriteAccess}
          className="bg-[#f59e0b] text-surface border border-[#fbbf24] px-2.5 py-1 cursor-pointer"
        >
          Enable autosave
        </button>
      )}
      <div className="flex gap-1.5">
        <button onClick={() => setTool('select')} aria-pressed={tool === 'select'} className={toolBtnCls('select')}>Select</button>
        <button onClick={() => setTool('box')} aria-pressed={tool === 'box'} className={toolBtnCls('box')}>Box</button>
        <button onClick={() => setTool('circle')} aria-pressed={tool === 'circle'} className={toolBtnCls('circle')}>Circle</button>
        <button onClick={() => setTool('highlight')} aria-pressed={tool === 'highlight'} className={toolBtnCls('highlight')}>Highlight</button>
        <button onClick={() => setTool('arrow')} aria-pressed={tool === 'arrow'} className={toolBtnCls('arrow')}>Arrow</button>
        <button onClick={() => setTool('poly')} aria-pressed={tool === 'poly'} className={toolBtnCls('poly')}>Poly</button>
        <button onClick={() => setTool('text')} aria-pressed={tool === 'text'} className={toolBtnCls('text')}>Text</button>
        <button onClick={() => setTool('calibrate')} aria-pressed={tool === 'calibrate'} className={toolBtnCls('calibrate')}>Calibrate</button>
      </div>
      <div className="flex items-center gap-1.5 ml-1.5">
        <span className="status">Stroke</span>
        <select value={strokePattern} onChange={(e) => setStrokePattern((e.target.value as StrokePattern) || 'solid')}>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
          <option value="dashdot">Dash-dot</option>
        </select>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-1.5">
        <span className="status">Color</span>
        <input type="color" value={defaultColor} onChange={(e) => setDefaultColor(e.target.value || '#000000')} />
      </div>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={enableForegroundOcclusion}
          onChange={(e) => setEnableForegroundOcclusion(e.target.checked)}
        />
        <span className="status">Occlusion</span>
      </label>
      <select
        value={occlusionMethod}
        onChange={(e) => setOcclusionMethod(e.target.value as any)}
        disabled={!enableForegroundOcclusion}
        className={enableForegroundOcclusion ? '' : 'opacity-60'}
      >
        <option value="edge">Edge</option>
        <option value="ml">ML</option>
      </select>
      <button onClick={() => { setSaveStatus({ state: 'saving' }); setSaveTick(t => t + 1); }}
        className="bg-[#10b981] text-surface border border-[#34d399] px-2.5 py-1 cursor-pointer">Save</button>
      <div className={`status min-w-[110px] ${saveStatusCls}`}>
        {saveStatus?.state === 'saving'
          ? 'Saving…'
          : saveStatus?.state === 'saved'
            ? (saveStatus?.message === 'already_saved' ? 'Already saved' : 'Saved')
            : saveStatus?.state === 'error'
              ? 'Save failed'
              : ''}
      </div>
      <div className="status">Zoom: {(scale * 100).toFixed(0)}%</div>
    </div>
  );

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
          <div className="status">Project folder connected, but access is not granted yet. Click enable to load the project and allow saving.</div>
          <div className="toolbar mt-2 flex gap-2">
            <button onClick={requestWriteAccess}>Enable access</button>
            <button onClick={openProject}>Pick Folder</button>
          </div>
          {error && <div className="status mt-2 text-danger">{error}</div>}
        </div>
      </div>
    );
  }
  if (!still) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">Still not found.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fullbleed">
      <div className="panel flex flex-col overflow-hidden" style={{ height: 'calc(100vh - var(--player-headroom) - 12px)', overscrollBehavior: 'none' }}>
        {toolbar}
        {error && <div className="status text-danger">{error}</div>}
        <div
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={`relative flex-1 min-h-0 bg-surface overflow-hidden touch-none ${panning ? 'cursor-grabbing' : 'cursor-default'}`}
          style={{ overscrollBehavior: 'none' }}
        >
          {imgUrl && (
            <Editor
              stillId={stillId}
              imageInfo={imageInfo}
              imgUrl={imgUrl}
              stageScale={scale}
              stageOffset={offset}
              tool={tool}
              defaultStrokePattern={strokePattern}
              defaultColor={defaultColor}
              enableForegroundOcclusion={enableForegroundOcclusion}
              occlusionMethod={occlusionMethod}
              onRequestToolChange={setTool}
              saveTick={saveTick}
              onSaveStatus={setSaveStatus}
            />
          )}
        </div>
      </div>
    </div>
  );
}
