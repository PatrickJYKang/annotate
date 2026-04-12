"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "../../lib/state/ProjectContext";
import {
  createDefaultPresentation,
  type Presentation,
} from "../../lib/types/presentation";
import {
  deletePresentation,
  duplicatePresentation,
  listPresentations,
  renamePresentation,
  writePresentation,
} from "../../lib/fs/presentationStorage";

function formatDateTime(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

export default function PresentationsPage() {
  const router = useRouter();
  const { projectDir, manifest } = useProject();
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const loadPresentations = useCallback(async () => {
    if (!projectDir) {
      setPresentations([]);
      return;
    }
    setLoading(true);
    try {
      const next = await listPresentations(projectDir);
      setPresentations(next);
      setRenameDrafts((prev) => {
        const mapped: Record<string, string> = {};
        for (const presentation of next) {
          mapped[presentation.id] = prev[presentation.id] ?? presentation.name;
        }
        return mapped;
      });
      setError(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [projectDir]);

  useEffect(() => {
    void loadPresentations();
  }, [loadPresentations]);

  const createPresentation = useCallback(async () => {
    if (!projectDir) return;
    const trimmed = newName.trim();
    if (!trimmed) {
      setError("Presentation name is required");
      return;
    }
    const id = (globalThis.crypto && "randomUUID" in globalThis.crypto)
      ? (globalThis.crypto as any).randomUUID()
      : `presentation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      setBusyId("create");
      await writePresentation(projectDir, createDefaultPresentation(trimmed, id));
      setNewName("");
      setError(null);
      setToast("Presentation created");
      await loadPresentations();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  }, [projectDir, newName, loadPresentations]);

  const handleRename = useCallback(async (presentationId: string) => {
    if (!projectDir) return;
    const nextName = (renameDrafts[presentationId] ?? "").trim();
    if (!nextName) {
      setError("Presentation name is required");
      return;
    }
    try {
      setBusyId(`rename:${presentationId}`);
      const renamed = await renamePresentation(projectDir, presentationId, nextName);
      if (!renamed) {
        setError("Presentation not found");
        return;
      }
      setRenameDrafts((prev) => ({ ...prev, [presentationId]: renamed.name }));
      setError(null);
      setToast("Presentation renamed");
      await loadPresentations();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  }, [projectDir, renameDrafts, loadPresentations]);

  const handleDuplicate = useCallback(async (presentation: Presentation) => {
    if (!projectDir) return;
    const id = (globalThis.crypto && "randomUUID" in globalThis.crypto)
      ? (globalThis.crypto as any).randomUUID()
      : `presentation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const nextName = `${presentation.name} Copy`;
    try {
      setBusyId(`duplicate:${presentation.id}`);
      const duplicated = await duplicatePresentation(projectDir, presentation.id, id, nextName);
      if (!duplicated) {
        setError("Presentation not found");
        return;
      }
      setError(null);
      setToast("Presentation duplicated");
      await loadPresentations();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  }, [projectDir, loadPresentations]);

  const handleDelete = useCallback(async (presentation: Presentation) => {
    if (!projectDir) return;
    const confirmed = window.confirm(`Delete presentation \"${presentation.name}\"?`);
    if (!confirmed) return;
    try {
      setBusyId(`delete:${presentation.id}`);
      await deletePresentation(projectDir, presentation.id);
      setError(null);
      setToast("Presentation deleted");
      await loadPresentations();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  }, [projectDir, loadPresentations]);

  const totalSlides = useMemo(
    () => presentations.reduce((sum, presentation) => sum + presentation.slides.length, 0),
    [presentations],
  );

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

  return (
    <div className="fullbleed flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-stretch bg-surface border-b border-border shrink-0">
          <button onClick={() => router.push('/stills')} className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base">← Stills</button>
          <div className="self-stretch flex items-center px-4 text-base font-medium">Presentations</div>
          <span className="flex-1" />
          <button onClick={loadPresentations} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Refresh</button>
        </div>

        {toast && <div className="shrink-0 px-3 py-1 text-xs text-warning border-b border-subtle">{toast}</div>}
        {error && <div className="shrink-0 px-3 py-1 text-xs text-danger border-b border-subtle">{error}</div>}

        <div className="flex-1 min-h-0 p-4 flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3 max-w-[720px]">
            <div className="panel">
              <div className="text-xs text-muted uppercase tracking-wide">Presentations</div>
              <div className="text-xl font-semibold mt-1">{presentations.length}</div>
            </div>
            <div className="panel">
              <div className="text-xs text-muted uppercase tracking-wide">Slides</div>
              <div className="text-xl font-semibold mt-1">{totalSlides}</div>
            </div>
            <div className="panel">
              <div className="text-xs text-muted uppercase tracking-wide">Project</div>
              <div className="text-sm font-medium mt-1 truncate">{manifest.name}</div>
            </div>
          </div>

          <div className="panel max-w-[720px]">
            <strong className="block mb-3">Create presentation</strong>
            <div className="flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Presentation name"
                className="flex-1 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void createPresentation();
                  }
                }}
              />
              <button onClick={createPresentation} disabled={busyId === 'create'} className="px-3 py-1.5 text-sm border-0 bg-[#2563eb] text-white cursor-pointer">
                {busyId === 'create' ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>

          <div className="panel flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <strong>Presentation list</strong>
              {loading && <span className="text-xs text-muted">Loading…</span>}
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto min-h-0">
              {presentations.map((presentation) => {
                const renameBusy = busyId === `rename:${presentation.id}`;
                const duplicateBusy = busyId === `duplicate:${presentation.id}`;
                const deleteBusy = busyId === `delete:${presentation.id}`;
                return (
                  <div key={presentation.id} className="border border-subtle rounded p-3 flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        value={renameDrafts[presentation.id] ?? presentation.name}
                        onChange={(e) => setRenameDrafts((prev) => ({ ...prev, [presentation.id]: e.target.value }))}
                        className="flex-1 min-w-[240px] text-sm"
                      />
                      <button onClick={() => router.push(`/presentation/${presentation.id}`)} className="px-3 py-1.5 text-sm cursor-pointer">
                        Open
                      </button>
                      <button onClick={() => handleRename(presentation.id)} disabled={renameBusy} className="px-3 py-1.5 text-sm cursor-pointer">
                        {renameBusy ? 'Saving…' : 'Rename'}
                      </button>
                      <button onClick={() => handleDuplicate(presentation)} disabled={duplicateBusy} className="px-3 py-1.5 text-sm cursor-pointer">
                        {duplicateBusy ? 'Duplicating…' : 'Duplicate'}
                      </button>
                      <button onClick={() => handleDelete(presentation)} disabled={deleteBusy} className="px-3 py-1.5 text-sm text-danger cursor-pointer">
                        {deleteBusy ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                    <div className="text-sm text-muted flex flex-wrap gap-x-4 gap-y-1">
                      <span>{presentation.slides.length} slides</span>
                      <span>{presentation.transitions.length} transitions</span>
                      <span>Created {formatDateTime(presentation.createdAt)}</span>
                      <span>Updated {formatDateTime(presentation.updatedAt)}</span>
                    </div>
                  </div>
                );
              })}
              {!loading && presentations.length === 0 && (
                <div className="text-sm text-muted py-2">No presentations yet. Create one to start assembling decks in Phase 3.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
