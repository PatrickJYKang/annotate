"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Panel,
  PanelResizeHandle,
  Panels,
} from '../components/panels/Panels';
import PresentationLibrary from '../components/presentation/PresentationLibrary';
import ProjectSetupScreen, {
  type ProjectSetupValues,
} from '../components/project/ProjectSetupScreen';
import { createProject } from '../lib/fs/projectFolder';
import { mutateProjectManifestExclusive } from '../lib/fs/projectManifestRepository';
import { emptyTrash } from '../lib/fs/trash';
import { importVideoIntoProject } from '../lib/fs/videoImport';
import {
  exportAllClips,
  type ClipExportFailure,
  type ClipExportProgress,
} from '../lib/export/clipExport';
import type { VideoNormalizationProgress } from '../lib/clip/sidecarClient';
import { useProject } from '../lib/state/ProjectContext';
import type { ProjectIntegrityIssue } from '../lib/utils/projectIntegrity';
import { useLocale, useT, type Translate } from '../lib/i18n';

function projectFolderName(projectName: string): string {
  return projectName.trim().replace(/[/:\\]/g, '-') || 'Untitled Project';
}

async function ensureReadWritePermission(handle: FileSystemDirectoryHandle, deniedMessage: string): Promise<void> {
  const current = handle.queryPermission
    ? await handle.queryPermission({ mode: 'readwrite' })
    : 'granted';
  if (current === 'granted') return;
  const requested = handle.requestPermission
    ? await handle.requestPermission({ mode: 'readwrite' })
    : 'denied';
  if (requested !== 'granted') throw new Error(deniedMessage);
}

function IntegrityIssue({ issue }: { issue: ProjectIntegrityIssue }) {
  const t = useT();
  return (
    <li className="border-t border-border py-2 first:border-t-0" data-integrity-code={issue.code}>
      <div className="flex items-baseline justify-between gap-3">
        <strong className={issue.severity === 'error' ? 'text-danger' : 'text-warning'}>
          {issue.code}
        </strong>
        <span className="font-mono text-xs text-muted">{issue.path}</span>
      </div>
      <p className="mb-0 mt-1 text-sm text-secondary">{t(`integrity.${issue.code}`)}</p>
    </li>
  );
}

function exportProgressLabel(
  progress: ClipExportProgress,
  t: Translate,
  formatNumber: (value: number) => string,
): string {
  if (progress.phase === 'rendering') {
    return t('export.rendering', {
      clip: progress.clipLabel ?? '',
      frame: formatNumber(progress.frame ?? 0),
      annotation: progress.annotationLabel ?? '',
    });
  }
  if (progress.phase === 'rendered') {
    return t('export.rendered', {
      done: formatNumber(progress.annotationDone ?? 0),
      total: formatNumber(progress.annotationTotal ?? 0),
    });
  }
  if (progress.phase === 'writing') return t('export.writing', { file: progress.file ?? '' });
  return progress.failures
    ? t('export.completeFailures', { count: formatNumber(progress.failures) })
    : t('export.complete');
}

export default function HomePage() {
  const router = useRouter();
  const { t, formatNumber } = useLocale();
  const {
    projectDir,
    manifest,
    board,
    integrityReport,
    selectedVideoId,
    setSelectedVideoId,
    isRestoring,
    restoreError,
    openProject,
    closeProject,
    refreshIntegrity,
  } = useProject();
  const [mounted, setMounted] = useState(false);
  const [fsSupported, setFsSupported] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<ClipExportProgress | null>(null);
  const [exportFailures, setExportFailures] = useState<ClipExportFailure[]>([]);
  const [normalizationProgress, setNormalizationProgress] = useState<VideoNormalizationProgress | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
    setFsSupported(
      typeof window !== 'undefined'
      && typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function',
    );
  }, []);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await operation();
    } catch (error) {
      if ((error as { name?: string })?.name !== 'AbortError') {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const createFromSetup = useCallback(async (values: ProjectSetupValues) => {
    await run(async () => {
      if (!fsSupported) throw new Error(t('project.chromiumRequired'));
      const parent = await (window as Window & {
        showDirectoryPicker: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker({ mode: 'readwrite' });
      await ensureReadWritePermission(parent, t('project.permissionDenied'));
      const project = await parent.getDirectoryHandle(projectFolderName(values.name), { create: true });
      await ensureReadWritePermission(project, t('project.permissionDenied'));
      await createProject(project, {
        name: values.name,
        matchInfo: values.matchInfo,
      });
      await openProject(project);
      setSetupOpen(false);
      setMessage(t('project.created'));
    });
  }, [fsSupported, openProject, run, t]);

  const openExisting = useCallback(async () => {
    await run(async () => {
      if (!fsSupported) throw new Error(t('project.chromiumRequired'));
      const project = await (window as Window & {
        showDirectoryPicker: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker({ mode: 'readwrite' });
      await ensureReadWritePermission(project, t('project.permissionDenied'));
      await openProject(project);
      setMessage(t('project.opened'));
    });
  }, [fsSupported, openProject, run, t]);

  const importVideo = useCallback(async () => {
    await run(async () => {
      if (!projectDir || !manifest) throw new Error(t('project.noOpen'));
      const picker = (window as Window & {
        showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
      }).showOpenFilePicker;
      if (!picker) throw new Error(t('project.chromiumRequired'));
      const handles = await picker({
        multiple: false,
        types: [{
          description: t('project.importDescription'),
          accept: { 'video/*': ['.mp4', '.mov', '.webm', '.mkv', '.avi'] },
        }],
      });
      const source = await handles[0]?.getFile();
      if (!source) return;
      setMessage(t('project.normalizing', { name: source.name }));
      setNormalizationProgress({ phase: 'uploading', progress: 0 });
      const controller = new AbortController();
      importAbortRef.current = controller;
      try {
        await importVideoIntoProject(projectDir, manifest, source, {
          onProgress: setNormalizationProgress,
          signal: controller.signal,
        });
        await openProject(projectDir, false);
        setMessage(t('project.imported', { name: source.name }));
      } finally {
        importAbortRef.current = null;
        setNormalizationProgress(null);
      }
    });
  }, [manifest, openProject, projectDir, run, t]);

  const saveNow = useCallback(async () => {
    await run(async () => {
      if (!projectDir || !manifest) return;
      await mutateProjectManifestExclusive(projectDir, (latest) => latest);
      await openProject(projectDir, false);
      setMessage(t('project.saved'));
    });
  }, [manifest, openProject, projectDir, run, t]);

  const clearTrash = useCallback(async () => {
    await run(async () => {
      if (!projectDir) return;
      const result = await emptyTrash(projectDir);
      await refreshIntegrity();
      setMessage(result.removedOperationIds.length === 1
        ? t('project.trashEmptiedOne')
        : result.removedOperationIds.length > 1
          ? t('project.trashEmptiedMany', { count: formatNumber(result.removedOperationIds.length) })
          : t('project.trashAlreadyEmpty'));
    });
  }, [formatNumber, projectDir, refreshIntegrity, run, t]);

  const exportReport = useCallback(async () => {
    if (!projectDir || !manifest || !board || !integrityReport) return;
    setExportBusy(true);
    setExportFailures([]);
    setMessage(null);
    try {
      const result = await exportAllClips({
        projectDir,
        manifest,
        clips: integrityReport.clips,
        board,
        onProgress: setExportProgress,
      });
      setExportFailures(result.failures);
      setMessage(result.failures.length
        ? t('project.exportedWithFailures', { count: formatNumber(result.failures.length) })
        : t('project.exported'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setExportBusy(false);
    }
  }, [board, formatNumber, integrityReport, manifest, projectDir, t]);

  const openPlayer = useCallback((videoId?: string) => {
    const target = videoId ?? selectedVideoId ?? manifest?.videos[0]?.id;
    if (!target) return;
    setSelectedVideoId(target);
    router.push('/player');
  }, [manifest?.videos, router, selectedVideoId, setSelectedVideoId]);

  if (!mounted || isRestoring) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-secondary">
        {t('project.restore')}
      </div>
    );
  }

  if (!projectDir || !manifest) {
    return (
      <div className="fullbleed flex min-h-full flex-1 items-center justify-center p-5">
        {setupOpen && (
          <ProjectSetupScreen
            fsSupported={fsSupported}
            busy={busy}
            onCreate={createFromSetup}
            onCancel={() => setSetupOpen(false)}
          />
        )}
        <section className="w-full max-w-[420px] border border-border bg-surface" aria-label={t('project.workspaceLabel')}>
          <header className="border-b border-border px-5 py-4">
            <h2 className="m-0 text-lg font-semibold">{t('project.openChooser')}</h2>
          </header>
          <div className="grid grid-cols-2 gap-2 p-5 max-sm:grid-cols-1">
            <button className="button-primary" disabled={busy || !fsSupported} onClick={() => setSetupOpen(true)}>
              {t('project.create')}
            </button>
            <button disabled={busy || !fsSupported} onClick={() => void openExisting()}>
              {t('project.open')}
            </button>
          </div>
          {!fsSupported && (
            <p className="m-0 border-t border-border px-5 py-3 text-xs text-danger">{t('project.chromiumRequired')}</p>
          )}
          {(message || restoreError) && (
            <p role="alert" className="m-0 border-t border-border bg-raised px-5 py-3 text-xs text-warning">
              {message ?? restoreError}
            </p>
          )}
        </section>
      </div>
    );
  }

  const issues = integrityReport?.issues ?? [];
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  const clips = integrityReport?.clips ?? [];
  const presentations = integrityReport?.presentations ?? [];
  const matchInfo = manifest.matchInfo;
  const matchLabel = matchInfo?.homeTeam.name || matchInfo?.awayTeam.name
    ? t('project.matchVersus', {
      home: matchInfo.homeTeam.name ?? t('metadata.home'),
      away: matchInfo.awayTeam.name ?? t('metadata.away'),
    })
    : t('project.matchUnset');

  return (
    <main className="fullbleed flex min-h-0 flex-1 overflow-hidden bg-canvas" data-testid="project-dashboard">
      <Panels
        autoSaveId="annotate:dashboard:sidebar-workspace"
        direction="horizontal"
        className="flex-1"
        data-testid="dashboard-panel-group"
      >
        <Panel id="dashboard-sidebar" defaultSize={18} minSize={14} maxSize={32}>
      <aside className="flex h-full w-full flex-col overflow-y-auto border-r border-border bg-surface" aria-label={t('project.controls')}>
        <div className="border-b border-border px-4 py-4">
          <h2 className="m-0 truncate text-lg font-semibold">{manifest.name}</h2>
          <p className="mb-0 mt-1 truncate text-xs text-secondary">{matchLabel}</p>
        </div>

        <div className="grid p-2">
          <button className="button-quiet w-full justify-start text-left" onClick={() => router.push('/metadata')}>{t('project.matchInfo')}</button>
          <button className="button-quiet w-full justify-start text-left" disabled={busy} onClick={() => void importVideo()}>{t('project.importVideo')}</button>
          <button className="button-quiet w-full justify-start text-left" disabled={busy} onClick={() => void saveNow()}>{t('project.saveNow')}</button>
          <button className="button-quiet w-full justify-start text-left" disabled={busy} onClick={() => void clearTrash()}>{t('project.emptyTrash')}</button>
        </div>

        <div className="mt-auto border-t border-border p-3">
          <div className="px-1 pb-3 text-xs text-secondary">
            <div className="flex justify-between"><span>{t('project.videos')}</span><strong>{formatNumber(manifest.videos.length)}</strong></div>
            <div className="mt-1 flex justify-between"><span>{t('project.clips')}</span><strong>{formatNumber(clips.length)}</strong></div>
            <div className="mt-1 flex justify-between"><span>{t('project.presentations')}</span><strong>{formatNumber(presentations.length)}</strong></div>
          </div>
          <button className="button-quiet w-full text-left" onClick={() => void closeProject()}>{t('project.close')}</button>
        </div>
      </aside>
        </Panel>
        <PanelResizeHandle direction="horizontal" data-testid="dashboard-resize-handle" />
        <Panel id="dashboard-workspace" defaultSize={82} minSize={52}>
      <div className="h-full min-w-0 overflow-y-auto p-5 lg:p-7">
        <div className="mx-auto max-w-[1500px]">
          <header className="mb-5 flex items-center justify-between gap-4">
            <h1 className="m-0 text-xl font-semibold">{t('project.workspace')}</h1>
            <button
              className="button-primary"
              onClick={() => openPlayer()}
              disabled={manifest.videos.length === 0}
            >
              {t('project.openCapture')}
            </button>
          </header>

          <div className="grid grid-cols-2 items-start gap-4 max-lg:grid-cols-1">
            <section className="panel min-w-0 overflow-hidden p-0" aria-labelledby="analysis-heading">
              <div className="panel-heading h-auto py-3">
                <h2 id="analysis-heading">{t('project.analysis')}</h2>
                <div className="flex gap-2">
                  <div data-testid="stat-videos" className="text-right">
                    <strong className="block text-xl">{formatNumber(manifest.videos.length)}</strong>
                    <span className="text-xs text-muted">{t('project.videos')}</span>
                  </div>
                  <div data-testid="stat-clips" className="border-l border-border pl-2 text-right">
                    <strong className="block text-xl">{formatNumber(clips.length)}</strong>
                    <span className="text-xs text-muted">{t('project.clips')}</span>
                  </div>
                </div>
              </div>

              <div className="grid">
                {manifest.videos.map((video) => {
                  const videoClipCount = clips.filter((clip) => clip.videoId === video.id).length;
                  return (
                    <article key={video.id} className="border-t border-border p-3 first:border-t-0" data-testid={`video-card-${video.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <strong className="block truncate">{video.label}</strong>
                          <p className="mb-0 mt-1 font-mono text-[10px] text-muted">
                            {t('project.videoStats', {
                              frames: formatNumber(video.frameCount),
                              fps: formatNumber(video.fps),
                              width: formatNumber(video.width),
                              height: formatNumber(video.height),
                            })}
                          </p>
                          <p className="mb-0 mt-2 text-xs text-secondary">{t('project.clipCount', { count: formatNumber(videoClipCount) })}</p>
                        </div>
                        <button className="button-quiet" aria-label={t('project.openPlayerFor', { name: video.label })} onClick={() => openPlayer(video.id)}>{t('common.open')}</button>
                      </div>
                    </article>
                  );
                })}
                {manifest.videos.length === 0 && (
                  <div className="empty-state m-3" aria-hidden="true" />
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border p-3">
                <button className="button-primary" disabled={busy} onClick={() => void importVideo()}>{t('project.importVideo')}</button>
                <button disabled={exportBusy} onClick={() => void exportReport()}>
                  {exportBusy ? t('project.exporting') : t('project.exportReport')}
                </button>
              </div>
            </section>

            <section className="panel min-w-0 overflow-hidden p-0" aria-labelledby="presentations-heading">
              <div className="panel-heading h-auto py-3">
                <h2 id="presentations-heading">{t('project.presentations')}</h2>
                <div data-testid="stat-presentations" className="text-right">
                  <strong className="block text-xl">{formatNumber(presentations.length)}</strong>
                  <span className="text-xs text-muted">{t('project.decks')}</span>
                </div>
              </div>
              <div className="p-3">
                <PresentationLibrary
                  projectDir={projectDir}
                  onOpen={(presentationId) => router.push(`/presentation/${presentationId}`)}
                  onChanged={refreshIntegrity}
                  compact
                />
              </div>
            </section>
          </div>

          {exportProgress && (
            <section className="panel mt-4" aria-label={t('project.exportProgress')}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{exportProgressLabel(exportProgress, t, formatNumber)}</span>
                <span className="font-mono text-xs text-muted">{formatNumber(exportProgress.done)}/{formatNumber(exportProgress.total)}</span>
              </div>
              <progress className="mt-2 w-full" max={Math.max(1, exportProgress.total)} value={exportProgress.done} />
              {exportFailures.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-warning">{t('project.exportFailures', { count: formatNumber(exportFailures.length) })}</summary>
                  <ul className="mb-0 mt-2 list-none p-0 text-xs text-secondary">
                    {exportFailures.map((failure, index) => (
                      <li key={`${failure.clipId}:${failure.annotationId ?? index}`} className="border-t border-border py-1 first:border-t-0">
                        <span className="font-mono">{failure.path ?? failure.clipId}</span> · {failure.error}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}

          {normalizationProgress && (
            <section
              className="panel fixed bottom-5 right-5 z-50 w-[min(28rem,calc(100vw-2.5rem))]"
              aria-label={t('project.normalizationProgress')}
              role="status"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{t(`project.normalization.${normalizationProgress.phase}`)}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted">
                    {formatNumber(Math.round(normalizationProgress.progress * 100))}%
                  </span>
                  <button className="px-2 py-1 text-xs" onClick={() => importAbortRef.current?.abort()}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
              <progress
                className="mt-2 w-full"
                max={1}
                value={normalizationProgress.progress}
              />
            </section>
          )}

          <details className="panel mt-4" open={issues.length > 0}>
            <summary className="cursor-pointer text-sm font-bold" data-testid="integrity-summary">
              {t('project.integrity', { errors: formatNumber(errorCount), warnings: formatNumber(warningCount) })}
            </summary>
            {issues.length === 0 ? (
              <p className="mb-0 mt-3 text-sm text-success">{t('project.integrityClear')}</p>
            ) : (
              <ul className="mb-0 mt-3 list-none p-0">
                {issues.map((issue, index) => (
                  <IntegrityIssue key={`${issue.code}:${issue.path}:${index}`} issue={issue} />
                ))}
              </ul>
            )}
          </details>

          {(message || restoreError) && (
            <div role="status" className="toast">
              {message ?? restoreError}
            </div>
          )}
        </div>
      </div>
        </Panel>
      </Panels>
    </main>
  );
}
