"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "../../lib/state/ProjectContext";
import type { ProjectManifestV1 } from "../../lib/types/project";
import { writeManifest } from "../../lib/fs/projectFolder";
import VideoPlayerUnit, { VideoPlayerHandle } from "../../components/player/VideoPlayerUnit";

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

export default function PlayerPage() {
  const router = useRouter();
  const { projectDir, manifest, setManifest, selectedVideoId } = useProject();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [seekMs, setSeekMs] = useState<number | null>(null);
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const manifestRef = useRef<ProjectManifestV1 | null>(null);
  const selectedVideoIdRef = useRef<string | null>(null);
  const selectedMarkIdRef = useRef<string | null>(null);

  useEffect(() => { manifestRef.current = manifest; }, [manifest]);
  useEffect(() => { selectedVideoIdRef.current = selectedVideoId; }, [selectedVideoId]);
  useEffect(() => { selectedMarkIdRef.current = selectedMarkId; }, [selectedMarkId]);

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

  const addMarkAt = useCallback(async (t_ms: number) => {
    const vid = selectedVideoIdRef.current;
    if (!vid) return;
    const id = (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? (globalThis.crypto as any).randomUUID() : `mark_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const next = await mutateManifestExclusive((mf) => {
      const video = mf.videos.find(v => v.id === vid);
      if (!video) return mf;
      return { ...mf, marks: [...mf.marks, { id, videoId: video.id, t_ms, tags: [] }] };
    });
    if (next) setSelectedMarkIdSafe(id);
  }, [mutateManifestExclusive, setSelectedMarkIdSafe]);

  const toggleTagDigit = useCallback(async (digit: string) => {
    const vid = selectedVideoIdRef.current;
    if (!vid) return;
    await mutateManifestExclusive((mf) => {
      const marksForVideo = mf.marks.filter(m => m.videoId === vid);
      const targetId = selectedMarkIdRef.current || (marksForVideo.length ? marksForVideo[marksForVideo.length - 1].id : null);
      if (!targetId) return mf;
      const nextMarks = mf.marks.map(m => {
        if (m.id !== targetId) return m;
        const set = new Set(m.tags);
        if (set.has(digit)) set.delete(digit); else set.add(digit);
        return { ...m, tags: Array.from(set).sort() };
      });
      return { ...mf, marks: nextMarks };
    });
  }, [mutateManifestExclusive]);

  const deleteSelectedMark = useCallback(async () => {
    const target = selectedMarkIdRef.current;
    if (!target) return;
    await mutateManifestExclusive((mf) => {
      const nextMarks = mf.marks.filter(m => m.id !== target);
      return { ...mf, marks: nextMarks };
    });
    setSelectedMarkIdSafe(null);
  }, [mutateManifestExclusive, setSelectedMarkIdSafe]);

  const marksForVideo = (manifest && selectedVideoId)
    ? manifest.marks.filter(m => m.videoId === selectedVideoId).sort((a, b) => a.t_ms - b.t_ms)
    : [];

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
      if (/^[1-9]$/.test(key)) { e.preventDefault(); await toggleTagDigit(key); return; }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [addMarkAt, toggleTagDigit, deleteSelectedMark, selectedMarkId, marksForVideo]);

  if (!projectDir || !manifest) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">No project open. Go back and open a project.</div>
          <div className="toolbar" style={{ marginTop: 8 }}>
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
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button onClick={() => router.push('/')}>Back to Home</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fullbleed">
      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <button onClick={onBack}>Back</button>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <VideoPlayerUnit
              ref={playerRef}
              src={videoUrl}
              fps={(manifest?.videos.find(v => v.id === selectedVideoId)?.fps) || 30}
              marks={marksForVideo.map(m => ({ id: m.id, t_ms: m.t_ms, tags: m.tags }))}
              onAddMark={addMarkAt}
              onToggleTag={toggleTagDigit}
              externalSeekMs={seekMs}
              selectedMarkId={selectedMarkId}
              onSelectMark={(id: string, t_ms: number) => { setSelectedMarkId(id); setSeekMs(t_ms); }}
              hotkeys={false}
              skipLargeSeconds={2}
              allowFullscreen
            />
            <div className="status" style={{ marginTop: 8 }}>Hotkeys anywhere: J/K/L, ←/→, ,/. · Hold Shift for ±2s skips · M adds mark · 1–9 toggle tags</div>
          </div>
          <div style={{ flex: '0 0 260px', minWidth: 260, height: 'calc(100vh - var(--player-headroom))', display: 'flex', flexDirection: 'column' }}>
            <strong>Marks</strong>
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', marginTop: 8 }}>
              <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
                {marksForVideo.map(m => (
                  <li key={m.id} style={{ flex: '1 1 120px', minWidth: 120 }}>
                    <button
                      onClick={() => { setSelectedMarkId(m.id); setSeekMs(m.t_ms || 0); }}
                      style={{ width: '100%', textAlign: 'left', background: selectedMarkId === m.id ? '#0f172a' : '#1f2937', borderColor: selectedMarkId === m.id ? '#60a5fa' : '#334155' }}
                    >
                      {formatTime(m.t_ms)} {m.tags.length ? ` · [${m.tags.join(',')}]` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="status">Press 1-9 to tag</div>
            <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={deleteSelectedMark} disabled={!selectedMarkId} title="Delete selected mark">Delete</button>
              <button onClick={onBack}>Back</button>
              <button onClick={() => router.push('/stills')}>Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
