"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "../../lib/state/ProjectContext";
import type { ProjectManifestV1 } from "../../lib/types/project";
import { getProjectFps } from "../../lib/types/project";
import { writeManifest } from "../../lib/fs/projectFolder";
import VideoPlayerUnit, { VideoPlayerHandle } from "../../components/player/VideoPlayerUnit";
import TaggingMenu, { TaggingMenuCloseReason } from "../../components/tagging/TaggingMenu";
import TagFolderTree from "../../components/tagging/TagFolderTree";
import {
  createEmptyTaggingSelection,
  ensureTaggingSelection,
  TaggingSelection,
} from "../../lib/tagging/schema";
import { findMarkAtTimestamp } from "../../lib/utils/projectIntegrity";

export default function PlayerPage() {
  const router = useRouter();
  const { projectDir, manifest, setManifest, selectedVideoId, taggingSchema } = useProject();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [seekMs, setSeekMs] = useState<number | null>(null);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [tagMenuAnchor, setTagMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [tagMenuSelection, setTagMenuSelection] = useState<TaggingSelection>(createEmptyTaggingSelection());
  const [tagMenuMarkId, setTagMenuMarkId] = useState<string | null>(null);
  const undoStackRef = useRef<{ marks: ProjectManifestV1['marks']; selectedMarkId: string | null }[]>([]);
  const redoStackRef = useRef<{ marks: ProjectManifestV1['marks']; selectedMarkId: string | null }[]>([]);
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const pageRootRef = useRef<HTMLDivElement | null>(null);
  const [pageHeightPx, setPageHeightPx] = useState<number | null>(null);
  const manifestRef = useRef<ProjectManifestV1 | null>(null);
  const selectedVideoIdRef = useRef<string | null>(null);
  const selectedMarkIdRef = useRef<string | null>(null);
  const resumeAfterTagConfirmRef = useRef(false);

  useEffect(() => { manifestRef.current = manifest; }, [manifest]);
  useEffect(() => { selectedVideoIdRef.current = selectedVideoId; }, [selectedVideoId]);
  useEffect(() => { selectedMarkIdRef.current = selectedMarkId; }, [selectedMarkId]);

  useEffect(() => {
    const updateAvailableHeight = () => {
      const el = pageRootRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setPageHeightPx(Math.max(0, Math.floor(window.innerHeight - top)));
    };

    updateAvailableHeight();
    window.addEventListener('resize', updateAvailableHeight);
    return () => window.removeEventListener('resize', updateAvailableHeight);
  }, []);

  const onBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  }, [router]);

  const setSelectedMarkIdSafe = useCallback((id: string | null) => {
    selectedMarkIdRef.current = id;
    setSelectedMarkId(id);
  }, []);

  const mutateManifestExclusive = useCallback(async (mut: (mf: ProjectManifestV1) => ProjectManifestV1) => {
    if (!projectDir) return null as ProjectManifestV1 | null;

    const doMutate = async () => {
      const cur = manifestRef.current;
      if (!cur) return null;
      const next = mut(cur);
      manifestRef.current = next;
      setManifest(next);
      await writeManifest(projectDir, next);
      return next;
    };

    const navAny: any = navigator as any;
    if (navAny?.locks?.request) {
      return await navAny.locks.request('project-manifest', { mode: 'exclusive' }, async () => await doMutate());
    }
    return await doMutate();
  }, [projectDir, setManifest]);

  useEffect(() => {
    if (seekMs == null) return;
    const t = setTimeout(() => setSeekMs(null), 0);
    return () => clearTimeout(t);
  }, [seekMs]);

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
      setSelectedMarkIdSafe(null);
    })();
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [projectDir, selectedVideoId]);

  const pushUndo = useCallback(() => {
    const cur = manifestRef.current;
    if (!cur) return;
    undoStackRef.current = [...undoStackRef.current.slice(-49), { marks: cur.marks, selectedMarkId: selectedMarkIdRef.current }];
    redoStackRef.current = [];
  }, []);

  const undo = useCallback(async () => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const cur = manifestRef.current;
    if (cur) {
      redoStackRef.current = [...redoStackRef.current.slice(-49), { marks: cur.marks, selectedMarkId: selectedMarkIdRef.current }];
    }
    const prev = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    await mutateManifestExclusive((mf) => ({ ...mf, marks: prev.marks }));
    setSelectedMarkIdSafe(prev.selectedMarkId);
  }, [mutateManifestExclusive, setSelectedMarkIdSafe]);

  const redo = useCallback(async () => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const cur = manifestRef.current;
    if (cur) {
      undoStackRef.current = [...undoStackRef.current.slice(-49), { marks: cur.marks, selectedMarkId: selectedMarkIdRef.current }];
    }
    const next = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    await mutateManifestExclusive((mf) => ({ ...mf, marks: next.marks }));
    setSelectedMarkIdSafe(next.selectedMarkId);
  }, [mutateManifestExclusive, setSelectedMarkIdSafe]);

  const openTagMenuForMarkById = useCallback((markId: string, anchor?: { x: number; y: number }) => {
    const mf = manifestRef.current;
    const vid = selectedVideoIdRef.current;
    const marks = mf && vid ? mf.marks.filter(m => m.videoId === vid) : [];
    const mark = marks.find((entry) => entry.id === markId);
    const selection = ensureTaggingSelection(mark?.tags);
    setSelectedMarkIdSafe(markId);
    setTagMenuSelection(selection);
    setTagMenuMarkId(markId);
    setTagMenuAnchor(anchor ?? { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) });
    setTagMenuOpen(true);
  }, [setSelectedMarkIdSafe]);

  const openTagMenuForMark = useCallback((markId: string, event: React.MouseEvent) => {
    event.preventDefault();
    openTagMenuForMarkById(markId, { x: event.clientX, y: event.clientY });
  }, [openTagMenuForMarkById]);

  const pauseForMarkTagging = useCallback(() => {
    const video = playerRef.current?.getVideoElement();
    const shouldResume = Boolean(video && !video.paused && !video.ended);
    resumeAfterTagConfirmRef.current = shouldResume;
    if (shouldResume) video?.pause();
  }, []);

  const addMarkAt = useCallback(async (t_ms: number) => {
    const vid = selectedVideoIdRef.current;
    if (!vid) return;
    pauseForMarkTagging();
    const existing = manifestRef.current ? findMarkAtTimestamp(manifestRef.current.marks, vid, t_ms) : null;
    if (existing) {
      setSelectedMarkIdSafe(existing.id);
      openTagMenuForMarkById(existing.id);
      return;
    }
    pushUndo();
    const id = (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? (globalThis.crypto as any).randomUUID() : `mark_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const next = await mutateManifestExclusive((mf) => {
      const video = mf.videos.find(v => v.id === vid);
      if (!video) return mf;
      return { ...mf, marks: [...mf.marks, { id, videoId: video.id, t_ms, tags: createEmptyTaggingSelection() }] };
    });
    if (next) {
      setSelectedMarkIdSafe(id);
      openTagMenuForMarkById(id);
    }
  }, [mutateManifestExclusive, setSelectedMarkIdSafe, pushUndo, openTagMenuForMarkById, pauseForMarkTagging]);

  const deleteSelectedMark = useCallback(async () => {
    const target = selectedMarkIdRef.current;
    if (!target) return;
    pushUndo();
    await mutateManifestExclusive((mf) => {
      const nextMarks = mf.marks.filter(m => m.id !== target);
      return { ...mf, marks: nextMarks };
    });
    setSelectedMarkIdSafe(null);
  }, [mutateManifestExclusive, setSelectedMarkIdSafe, pushUndo]);

  const clearTagsOnSelectedMark = useCallback(async () => {
    const target = selectedMarkIdRef.current;
    if (!target) return;
    pushUndo();
    await mutateManifestExclusive((mf) => {
      const nextMarks = mf.marks.map((m) => (m.id === target ? { ...m, tags: createEmptyTaggingSelection() } : m));
      return { ...mf, marks: nextMarks };
    });
  }, [mutateManifestExclusive, pushUndo]);

  const marksForVideo = useMemo(() => {
    if (!manifest || !selectedVideoId) return [];
    return manifest.marks.filter(m => m.videoId === selectedVideoId).sort((a, b) => a.t_ms - b.t_ms);
  }, [manifest, selectedVideoId]);

  const handleTreeSelectMark = useCallback((markId: string) => {
    const mark = marksForVideo.find((m) => m.id === markId);
    if (mark) {
      setSelectedMarkIdSafe(markId);
      setSeekMs(mark.t_ms);
    }
  }, [marksForVideo, setSelectedMarkIdSafe]);

  const handleDropMarkOnNode = useCallback(async (markId: string, nodeId: string) => {
    const mf = manifestRef.current;
    if (!mf) return;
    const mark = mf.marks.find((m) => m.id === markId);
    const existing = ensureTaggingSelection(mark?.tags);
    if (existing.primary === nodeId) return;
    const updated: TaggingSelection = { primary: nodeId, facets: {} };
    pushUndo();
    await mutateManifestExclusive((m) => {
      const nextMarks = m.marks.map((mk) => (mk.id === markId ? { ...mk, tags: updated } : mk));
      return { ...m, marks: nextMarks };
    });
  }, [mutateManifestExclusive, pushUndo]);

  const saveTaggingSelection = useCallback(async (markId: string, selection: TaggingSelection) => {
    pushUndo();
    await mutateManifestExclusive((mf) => {
      const nextMarks = mf.marks.map((mark) => (mark.id === markId ? { ...mark, tags: selection } : mark));
      return { ...mf, marks: nextMarks };
    });
  }, [mutateManifestExclusive, pushUndo]);

  const handleTagMenuClose = useCallback(async (selection: TaggingSelection, reason: TaggingMenuCloseReason) => {
    const shouldResume = resumeAfterTagConfirmRef.current;
    resumeAfterTagConfirmRef.current = false;
    setTagMenuOpen(false);
    setTagMenuAnchor(null);
    try {
      if (reason === "confirm" && tagMenuMarkId) {
        await saveTaggingSelection(tagMenuMarkId, selection);
      }
    } finally {
      setTagMenuMarkId(null);
      if (shouldResume) {
        await playerRef.current?.getVideoElement()?.play().catch(() => {});
      }
    }
  }, [saveTaggingSelection, tagMenuMarkId]);

  // Global keyboard shortcuts for the entire page
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
      if (key === ' ' || key === 'Spacebar' || key === 'Space') { e.preventDefault(); await api.playPause(); return; }
      if (key === 'k' || key === 'K') { e.preventDefault(); await api.playPause(); return; }
      if (key === 'j' || key === 'J' || key === ',') { e.preventDefault(); shift ? api.nudgeLarge(-1) : api.stepFrame(-1); return; }
      if (key === 'l' || key === 'L' || key === '.') { e.preventDefault(); shift ? api.nudgeLarge(1) : api.stepFrame(1); return; }
      if (key === 'ArrowLeft') { e.preventDefault(); shift ? api.nudgeLarge(-1) : api.nudgeSmall(-1); return; }
      if (key === 'ArrowRight') { e.preventDefault(); shift ? api.nudgeLarge(1) : api.nudgeSmall(1); return; }
      if (key === 'm' || key === 'M') { e.preventDefault(); api.addMark(); return; }
      if (key === 'Backspace' || key === 'Delete') { if (selectedMarkId) { e.preventDefault(); await deleteSelectedMark(); } return; }
      if (key === 'c' || key === 'C') { if (selectedMarkId) { e.preventDefault(); await clearTagsOnSelectedMark(); } return; }
      if (key === 'z' && (meta || e.ctrlKey) && !shift) { e.preventDefault(); await undo(); return; }
      if (key === 'z' && (meta || e.ctrlKey) && shift) { e.preventDefault(); await redo(); return; }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [addMarkAt, deleteSelectedMark, clearTagsOnSelectedMark, undo, redo, selectedMarkId, marksForVideo]);

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
      <div
        ref={pageRootRef}
        className="flex flex-col overflow-hidden"
        style={{ height: pageHeightPx != null ? `${pageHeightPx}px` : 'calc(100vh - var(--player-headroom))' }}
      >
        {/* Navbar */}
        <div className="flex items-stretch bg-surface border-b border-border shrink-0">
          <button onClick={onBack} className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base">← Back</button>
          <button onClick={() => router.push('/metadata')} className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base">Match info</button>
          <span className="flex-1" />
          <button onClick={deleteSelectedMark} disabled={!selectedMarkId} title="Delete selected mark (Delete)" className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Delete</button>
          <button onClick={() => router.push('/stills')} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Stills →</button>
        </div>

        {/* Main content: video left, tag tree right */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left pane — Video */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <VideoPlayerUnit
              ref={playerRef}
              src={videoUrl}
              fps={getProjectFps(manifest)}
              marks={marksForVideo.map(m => ({ id: m.id, t_ms: m.t_ms, tags: m.tags }))}
              onAddMark={addMarkAt}
              externalSeekMs={seekMs}
              selectedMarkId={selectedMarkId}
              onSelectMark={(id: string, t_ms: number) => { setSelectedMarkIdSafe(id); setSeekMs(t_ms); }}
              hotkeys={false}
              skipLargeSeconds={2}
              allowFullscreen
            />
          </div>

          {/* Right pane — Tag folder tree */}
          <div className="flex-[0_0_300px] min-w-[280px] min-h-0 overflow-hidden flex flex-col border-l border-subtle">
            {taggingSchema ? (
              <TagFolderTree
                schema={taggingSchema}
                marks={marksForVideo}
                selectedMarkId={selectedMarkId}
                onSelectMark={handleTreeSelectMark}
                onContextMenu={openTagMenuForMark}
                onDropMarkOnNode={handleDropMarkOnNode}
              />
            ) : (
              <div className="p-3 text-muted text-sm">
                No tagging schema loaded. Open project settings to add one.
              </div>
            )}
          </div>
        </div>

        <TaggingMenu
          open={tagMenuOpen}
          schema={taggingSchema}
          selection={tagMenuSelection}
          anchorPoint={tagMenuAnchor}
          onSelectionChange={setTagMenuSelection}
          onClose={handleTagMenuClose}
          onClear={() => {
            const empty = createEmptyTaggingSelection();
            setTagMenuSelection(empty);
            if (tagMenuMarkId) {
              pushUndo();
              saveTaggingSelection(tagMenuMarkId, empty);
            }
          }}
        />
      </div>
    </div>
  );
}
