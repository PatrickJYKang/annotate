"use client";
import { useCallback, useEffect, useState } from "react";
import { flushSync, createPortal } from "react-dom";
import type { ProjectManifestV1 } from "../lib/types/project";
import { useProject } from "../lib/state/ProjectContext";
import { useRouter } from "next/navigation";
import { ensureProjectFolderStructure, validateProjectFolderStructure, writeManifest } from "../lib/fs/projectFolder";
import { uniqueFileName } from "../lib/fs/utils";
import { extractVideoMetadata } from "../lib/media/metadata";
import { readTaggingSchema, writeDefaultTaggingSchema } from "../lib/tagging/schema";

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2400);
    return () => clearTimeout(t);
  }, [msg]);
  return { msg, show: setMsg } as const;
}

function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function pad3(n: number) { return n.toString().padStart(3, '0'); }
function formatTime(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms || 0));
  let r = clamped;
  const hh = Math.floor(r / 3600000); r %= 3600000;
  const mm = Math.floor(r / 60000); r %= 60000;
  const ss = Math.floor(r / 1000); const mmm = r % 1000;
  return hh > 0 ? `${hh}:${pad2(mm)}:${pad2(ss)}.${pad3(mmm)}` : `${mm}:${pad2(ss)}.${pad3(mmm)}`;
}

export default function Page() {
  const router = useRouter();
  const { projectDir, setProjectDir, manifest, setManifest, selectedVideoId, setSelectedVideoId, setTaggingSchema } = useProject();
  const [mounted, setMounted] = useState(false);
  const [fsSupported, setFsSupported] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadLabel, setUploadLabel] = useState("");
  const [showStillLoading, setShowStillLoading] = useState(false);
  const { msg, show } = useToast();

  useEffect(() => {
    setMounted(true);
    setFsSupported(typeof window !== "undefined" && typeof (window as any).showDirectoryPicker === "function");
  }, []);

  useEffect(() => {
    if (!uploading || typeof uploadProgress !== 'number' || uploadProgress < 99) {
      setShowStillLoading(false);
      return;
    }
    const id = setTimeout(() => setShowStillLoading(true), 2000);
    return () => clearTimeout(id);
  }, [uploading, uploadProgress]);

  const ensurePermission = useCallback(async (dir: FileSystemDirectoryHandle) => {
    // Request readwrite permission if needed
    if ((await dir.queryPermission({ mode: "readwrite" })) !== "granted") {
      const res = await dir.requestPermission({ mode: "readwrite" });
      if (res !== "granted") throw new Error("Permission denied");
    }
  }, []);

  const handleCreate = useCallback(async () => {
    try {
      if (!fsSupported) {
        show("This feature requires Chromium (File System Access API).");
        return;
      }
      // Pick parent folder
      const parent: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      let name = prompt("Name your project folder", "MyMatch");
      if (!name) return;
      if (!name.toLowerCase().endsWith(".matchproj")) name = name + ".matchproj";
      const project = await parent.getDirectoryHandle(name, { create: true });
      await ensurePermission(project);
      const mf = await ensureProjectFolderStructure(project, name.replace(/\.matchproj$/i, ""));
      const schema = await readTaggingSchema(project);
      setProjectDir(project);
      setManifest(mf);
      setTaggingSchema(schema);
      show("Project created");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      show(e?.message || "Failed to create project");
    }
  }, [fsSupported, ensurePermission, show]);

  const handleOpen = useCallback(async () => {
    try {
      if (!fsSupported) {
        show("This feature requires Chromium (File System Access API).");
        return;
      }
      const dir: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      await ensurePermission(dir);
      const v = await validateProjectFolderStructure(dir);
      if (!v.ok) {
        throw new Error(`Not a valid project folder: ${v.reason}`);
      }
      const mf = v.manifest;
      let schema = await readTaggingSchema(dir);
      if (!schema) {
        const addDefault = confirm(
          "This project does not have a tagging schema.\nAdd the default schema?"
        );
        if (addDefault) {
          try {
            schema = await writeDefaultTaggingSchema(dir);
          } catch (e2: any) {
            show(e2?.message || "Failed to write default schema");
          }
        }
      }
      setProjectDir(dir);
      setManifest(mf);
      setTaggingSchema(schema);
      show("Project opened");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      show(e?.message || "Failed to open project");
    }
  }, [fsSupported, ensurePermission, show]);

  const handleSaveNow = useCallback(async () => {
    if (!projectDir || !manifest) return;
    try {
      await writeManifest(projectDir, manifest);
      show("Project saved");
    } catch (e: any) {
      show(e?.message || "Failed to save project");
    }
  }, [projectDir, manifest, show]);

  const handleClose = useCallback(() => {
    setProjectDir(null);
    setManifest(null);
    setSelectedVideoId(null);
    setTaggingSchema(null);
  }, [setProjectDir, setManifest, setSelectedVideoId, setTaggingSchema]);

  const addVideosToManifest = useCallback((mf: ProjectManifestV1, entries: { name: string; relPath: string; meta: { durationMs?: number; width?: number; height?: number; fps?: number } }[]) => {
    const next = { ...mf, videos: [...mf.videos] };
    for (const e of entries) {
      const id = (globalThis.crypto && "randomUUID" in globalThis.crypto) ? (globalThis.crypto as any).randomUUID() : `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      next.videos.push({ id, label: e.name, file: e.relPath, durationMs: e.meta.durationMs, width: e.meta.width, height: e.meta.height, fps: e.meta.fps });
    }
    return next;
  }, []);

  const importFiles = useCallback(async (files: File[]) => {
    if (!projectDir || !manifest) return;
    let overlayStart = 0;
    try {
      const mediaDir = await projectDir.getDirectoryHandle("media", { create: true });
      const candidates = files.filter(f => f.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/i.test(f.name));
      if (candidates.length === 0) {
        show("No supported videos to import");
        return;
      }
      const totalBytes = candidates.reduce((acc, f) => acc + (f.size || 0), 0);
      let writtenBytes = 0;
      flushSync(() => {
        setUploading(true);
        setUploadProgress(0);
      });
      // Allow the overlay to render before heavy IO
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      overlayStart = performance.now();
      const added: { name: string; relPath: string; meta: { durationMs?: number; width?: number; height?: number; fps?: number } }[] = [];
      for (const file of candidates) {
        setUploadLabel(file.name);
        const name = await uniqueFileName(mediaDir, file.name);
        const fh = await mediaDir.getFileHandle(name, { create: true });
        const ws = await fh.createWritable();
        const reader = file.stream().getReader();
        let lastPaint = performance.now();
        let lastPct = -1;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            await ws.write(value);
            writtenBytes += value.byteLength || 0;
            if (totalBytes > 0) {
              const pct = Math.min(100, (writtenBytes / totalBytes) * 100);
              const now = performance.now();
              if (pct - lastPct >= 1 || now - lastPaint >= 50) {
                setUploadProgress(pct);
                lastPct = pct;
                lastPaint = now;
                // Let the browser paint occasionally
                await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
              }
            }
          }
        }
        await ws.close();
        const meta = await extractVideoMetadata(file);
        added.push({ name, relPath: `media/${name}`, meta });
      }
      if (added.length > 0) {
        const next = addVideosToManifest(manifest, added);
        setManifest(next);
        await writeManifest(projectDir, next);
        show(`Imported ${added.length} video${added.length > 1 ? "s" : ""}`);
      } else {
        show("No supported videos to import");
      }
    } catch (e: any) {
      show(e?.message || "Import failed");
    } finally {
      const elapsed = performance.now() - overlayStart;
      const MIN_DISPLAY = 600; // ms
      if (elapsed < MIN_DISPLAY) {
        await new Promise<void>(r => setTimeout(r, MIN_DISPLAY - elapsed));
      }
      setUploading(false);
      setUploadProgress(null);
      setUploadLabel("");
    }
  }, [projectDir, manifest, addVideosToManifest, show]);

  const handleImportClick = useCallback(async () => {
    try {
      if (!projectDir || !manifest) return;
      const picker: any[] = await (window as any).showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "Videos",
            accept: { "video/*": [".mp4", ".mov", ".webm", ".mkv", ".avi"] },
          },
        ],
      });
      const files: File[] = [];
      for (const h of picker) {
        try { files.push(await h.getFile()); } catch {}
      }
      if (files.length) await importFiles(files);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      show(e?.message || "Picker failed");
    }
  }, [projectDir, manifest, importFiles, show]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!projectDir) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, [projectDir]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    if (!projectDir) return;
    e.preventDefault();
    const files: File[] = [];
    for (const item of Array.from(e.dataTransfer.items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) await importFiles(files);
  }, [projectDir, importFiles]);

  if (!mounted) {
    // Avoid SSR/CSR mismatch by rendering nothing until mounted
    return null;
  }

  return (
    <div>
      <div className="toolbar">
        <button onClick={handleCreate}>Create Project Folder…</button>
        <button onClick={handleOpen}>Open Project Folder…</button>
        <button onClick={handleImportClick} disabled={!projectDir}>Import Video…</button>
        <button onClick={handleSaveNow} disabled={!projectDir}>Save Now</button>
        <button onClick={handleClose} disabled={!projectDir}>Close Project</button>
      </div>

      {mounted && !fsSupported && (
        <div className="panel">
          <strong>Chromium required.</strong> Use Chrome/Edge/Opera to open or create project folders.
        </div>
      )}

      {process.env.NODE_ENV === 'development' && (
        <div className="panel text-sm text-secondary">
          <strong>Note:</strong> The <code>.matchproj</code> suffix is currently just a naming convention for easier identification during development. It has no functional effect.
        </div>
      )}

      <div className="panel" onDragOver={onDragOver} onDrop={onDrop}>
        <h3 className="mt-0 text-base font-bold">Current Project</h3>
        {!projectDir ? (
          <div className="status">No project open.</div>
        ) : (
          <div>
            <div className="status">Folder: {projectDir.name}</div>
            {manifest ? (
              <div>
                <div>Name: {manifest.name}</div>
                <div>Created: {new Date(manifest.created).toLocaleString()}</div>
                <div>Videos: {manifest.videos.length} · Marks: {manifest.marks.length} · Stills: {manifest.stills.length}</div>
                {manifest.videos.length > 0 && (
                  <div className="mt-2">
                    <strong className="text-sm">Videos</strong>
                    <div className="mt-1 flex flex-col">
                      {manifest.videos.map(v => (
                        <button
                          key={v.id}
                          onClick={async () => { setSelectedVideoId(v.id); router.push('/player'); }}
                          className={`w-full text-left px-3 py-2 text-sm border border-border ${
                            selectedVideoId === v.id
                              ? 'bg-base border-focus'
                              : 'bg-raised'
                          }`}
                        >
                          <span>{v.label}</span>
                          <span className="text-secondary ml-2">
                            {typeof v.durationMs === 'number' ? `${Math.round((v.durationMs||0)/1000)}s` : ''}
                            {v.width && v.height ? ` · ${v.width}×${v.height}` : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {manifest.videos.length > 0 && (
                  <div className="mt-2">
                    <button
                      onClick={() => router.push('/metadata')}
                      className="w-full text-left px-3 py-2 text-sm"
                    >
                      {manifest.matchInfo ? 'Edit match info' : 'Set up match info →'}
                    </button>
                  </div>
                )}
                {typeof uploadProgress === 'number' && (
                  <>
                    <div className="progress"><div style={{ width: `${Math.round(uploadProgress)}%` }} /></div>
                    <div className="percent">{Math.round(uploadProgress)}%</div>
                  </>
                )}
              </div>
            ) : (
              <div className="status">Loading manifest…</div>
            )}
          </div>
        )}
      </div>

      {/* Player moved to /player */}

      {uploading && (typeof document !== 'undefined') && createPortal(
        <div className="overlay" role="status" aria-live="polite">
          <div className="loader">
            <div className="spinner" />
            <div className="text-center text-sm">{uploadLabel ? `Uploading ${uploadLabel}…` : 'Uploading…'}</div>
            {typeof uploadProgress === 'number' && (
              <>
                <div className="progress"><div style={{ width: `${Math.round(uploadProgress)}%` }} /></div>
                <div className="percent">{Math.round(uploadProgress)}%</div>
              </>
            )}
            {showStillLoading && (
              <div className="percent">Still loading…</div>
            )}
          </div>
        </div>,
        document.body
      )}

      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
