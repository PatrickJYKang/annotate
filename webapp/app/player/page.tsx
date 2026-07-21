"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import VideoPlayerUnit, {
  type FrameRangeMarker,
  type TimelineLane,
  type VideoPlayerHandle,
} from '../../components/player/VideoPlayerUnit';
import {
  Panel,
  PanelResizeHandle,
  Panels,
} from '../../components/panels/Panels';
import ClipTagTree from '../../components/tagging/ClipTagTree';
import TagBoard, { type TagBoardMode } from '../../components/tagging/TagBoard';
import { frameBoundary, videoFrame } from '../../lib/clip/frameMath';
import {
  createClipExclusive,
  deleteClipExclusive,
  replaceClipTagsExclusive,
  restoreClipExclusive,
} from '../../lib/fs/clipRepository';
import { listClips } from '../../lib/fs/clipStorage';
import { getFilePath, splitSafeRelativePath } from '../../lib/fs/fsAccess';
import type { TrashOperationRecord } from '../../lib/fs/trash';
import {
  facetRequirementsSatisfied,
  findBoardButton,
  pruneInapplicableFacets,
  type TaggingBoard,
} from '../../lib/tagging/board';
import {
  buildHotkeyMap,
  createCaptureEngine,
  type ActiveRangeCapture,
  type CaptureEngine,
} from '../../lib/tagging/capture';
import {
  createEmptyTaggingSelection,
  type TaggingSelection,
} from '../../lib/tagging/selection';
import { useProject } from '../../lib/state/ProjectContext';
import type { Clip } from '../../lib/types/clip';
import { useLocale } from '../../lib/i18n';

function makeId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}-${random}`;
}

const TIMELINE_LANE_COLORS = ['#5ca0e5', '#58bfa3', '#ef8e58', '#d977a8'];

function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return !!element && (
    element.isContentEditable
    || element.tagName === 'INPUT'
    || element.tagName === 'TEXTAREA'
    || element.tagName === 'SELECT'
  );
}

function toggleFacetValue(
  board: TaggingBoard,
  current: TaggingSelection['facets'],
  facetGroupId: string,
  optionId: string,
): TaggingSelection['facets'] {
  const facet = board.facets.find((candidate) => candidate.id === facetGroupId);
  if (!facet) return current;
  const next = structuredClone(current);
  const selected = next[facetGroupId];
  if (facet.mode === 'multi') {
    const values = new Set(Array.isArray(selected) ? selected : selected ? [selected] : []);
    if (values.has(optionId)) values.delete(optionId);
    else values.add(optionId);
    if (values.size > 0) next[facetGroupId] = [...values];
    else delete next[facetGroupId];
  } else if (selected === optionId) {
    delete next[facetGroupId];
  } else {
    next[facetGroupId] = optionId;
  }

  let changed = true;
  while (changed) {
    changed = false;
    const selection: TaggingSelection = { primary: null, facets: next };
    for (const candidate of board.facets) {
      if (!(candidate.id in next) || facetRequirementsSatisfied(candidate, selection)) continue;
      delete next[candidate.id];
      changed = true;
    }
  }
  return next;
}

export default function CapturePlayerPage() {
  const router = useRouter();
  const { t, formatNumber } = useLocale();
  const {
    projectDir,
    manifest,
    board,
    selectedVideoId,
    setSelectedVideoId,
    isRestoring,
    refreshIntegrity,
  } = useProject();
  const [player, setPlayer] = useState<VideoPlayerHandle | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [presentedFrame, setPresentedFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [armedFacets, setArmedFacets] = useState<TaggingSelection['facets']>({});
  const [activeRangeCaptures, setActiveRangeCaptures] = useState<ActiveRangeCapture[]>([]);
  const [untaggedStartFrame, setUntaggedStartFrame] = useState<number | null>(null);
  const [boardMode, setBoardMode] = useState<TagBoardMode>('capture');
  const [lastCreatedClipId, setLastCreatedClipId] = useState<string | null>(null);
  const [undoDeletion, setUndoDeletion] = useState<TrashOperationRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const captureEngineRef = useRef<CaptureEngine | null>(null);
  const armedFacetsRef = useRef<TaggingSelection['facets']>({});
  const localizationRef = useRef({ t, formatNumber });

  const selectedVideo = manifest?.videos.find((video) => video.id === selectedVideoId) ?? null;
  const videoClips = clips.filter((clip) => clip.videoId === selectedVideoId);
  const selectedClip = videoClips.find((clip) => clip.id === selectedClipId) ?? null;
  const hotkeys = useMemo(() => board ? buildHotkeyMap(board) : null, [board]);
  const timelineLanes = useMemo<TimelineLane[]>(() => (
    board?.groups.map((group, index) => ({
      id: group.id,
      label: group.label,
      color: TIMELINE_LANE_COLORS[index % TIMELINE_LANE_COLORS.length],
    })) ?? []
  ), [board]);
  const buttonLaneIds = useMemo(() => new Map(
    board?.groups.flatMap((group) => group.buttons.map((button) => [button.id, group.id] as const)) ?? [],
  ), [board]);
  const timelineRanges = useMemo<FrameRangeMarker[]>(() => {
    if (!selectedVideo) return [];
    const pendingEndFrame = (startFrame: number) => Math.min(
      selectedVideo.frameCount,
      Math.max(startFrame + 1, presentedFrame + 1),
    );
    return [
      ...videoClips.map((clip) => ({
        id: clip.id,
        startFrame: clip.startFrame,
        endFrame: clip.endFrame,
        label: clip.label,
        laneId: clip.tags.primary ? buttonLaneIds.get(clip.tags.primary) : undefined,
      })),
      ...activeRangeCaptures.map((range) => ({
        id: `active-${range.buttonId}`,
        startFrame: range.startFrame,
        endFrame: pendingEndFrame(range.startFrame),
        label: range.buttonLabel,
        laneId: buttonLaneIds.get(range.buttonId),
        pending: true,
      })),
      ...(untaggedStartFrame === null ? [] : [{
        id: 'active-untagged',
        startFrame: untaggedStartFrame,
        endFrame: pendingEndFrame(untaggedStartFrame),
        label: t('player.untaggedClip'),
        pending: true,
      }]),
    ];
  }, [activeRangeCaptures, buttonLaneIds, presentedFrame, selectedVideo, t, untaggedStartFrame, videoClips]);

  const reloadClips = useCallback(async () => {
    if (!projectDir) return;
    const result = await listClips(projectDir);
    setClips(result.clips);
    if (result.errors.length > 0) {
      setMessage(result.errors.length === 1
        ? t('player.clipReadErrorOne')
        : t('player.clipReadErrorMany', { count: formatNumber(result.errors.length) }));
    }
  }, [formatNumber, projectDir, t]);

  useEffect(() => {
    void reloadClips();
  }, [reloadClips]);

  useEffect(() => {
    armedFacetsRef.current = armedFacets;
  }, [armedFacets]);

  useEffect(() => {
    localizationRef.current = { t, formatNumber };
  }, [formatNumber, t]);

  useEffect(() => {
    if (!projectDir || !selectedVideo) {
      setVideoUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const handle = await getFilePath(projectDir, splitSafeRelativePath(selectedVideo.file), false);
        const file = await handle.getFile();
        if (!active) return;
        objectUrl = URL.createObjectURL(file);
        setVideoUrl(objectUrl);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectDir, selectedVideo]);

  useEffect(() => {
    const canceled = captureEngineRef.current?.cancelAllRanges() ?? [];
    if (canceled.length > 0) {
      const localization = localizationRef.current;
      setMessage(canceled.length === 1
        ? localization.t('player.rangeCanceledOnVideoOne')
        : localization.t('player.rangeCanceledOnVideoMany', {
          count: localization.formatNumber(canceled.length),
        }));
    }
    setActiveRangeCaptures([]);
    setUntaggedStartFrame(null);
    setBoardMode('capture');
    setArmedFacets({});
    setSelectedClipId(null);
    setLastCreatedClipId(null);
    if (!board || !selectedVideo) {
      captureEngineRef.current = null;
      return;
    }
    captureEngineRef.current = createCaptureEngine({
      board,
      videoFrameCount: selectedVideo.frameCount,
      videoFps: selectedVideo.fps,
      videoId: selectedVideo.id,
      getArmedFacets: () => armedFacetsRef.current,
      onFacetsConsumed: (facetGroupIds) => {
        setArmedFacets((current) => {
          const next = { ...current };
          facetGroupIds.forEach((facetGroupId) => delete next[facetGroupId]);
          return next;
        });
      },
      createId: () => makeId('clip'),
    });
  }, [board, selectedVideo]);

  const runMutation = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await operation();
      await reloadClips();
      await refreshIntegrity();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [refreshIntegrity, reloadClips]);

  const persistCapturedClip = useCallback(async (clip: Clip) => {
    if (!projectDir) return;
    await runMutation(async () => {
      const created = await createClipExclusive(projectDir, clip);
      setSelectedClipId(created.id);
      setLastCreatedClipId(created.id);
      setUndoDeletion(null);
      setMessage(t('player.captured', {
        label: created.label || created.id,
        start: formatNumber(created.startFrame),
        end: formatNumber(created.endFrame - 1),
      }));
    });
  }, [formatNumber, projectDir, runMutation, t]);

  const selectClip = useCallback((clip: Clip) => {
    setSelectedClipId(clip.id);
    player?.seekFrameAndReveal(clip.startFrame);
  }, [player]);

  const saveTags = useCallback(async (clipId: string, selection: TaggingSelection) => {
    if (!projectDir || !board) return;
    const next = selection.primary && findBoardButton(board, selection.primary)
      ? pruneInapplicableFacets(board, selection.primary, selection)
      : createEmptyTaggingSelection();
    await runMutation(async () => {
      await replaceClipTagsExclusive(projectDir, clipId, next);
      setMessage(next.primary ? t('player.retagSaved') : t('player.retagCleared'));
    });
  }, [board, projectDir, runMutation, t]);

  const toggleFacet = useCallback((facetGroupId: string, optionId: string, contextButtonId?: string | null) => {
    if (!board) return;
    const activeButtonId = contextButtonId
      ?? activeRangeCaptures[activeRangeCaptures.length - 1]?.buttonId
      ?? null;
    const active = boardMode === 'capture'
      ? activeRangeCaptures.find((candidate) => candidate.buttonId === activeButtonId)
      : null;
    if (active) {
      const next = toggleFacetValue(board, active.facets, facetGroupId, optionId);
      captureEngineRef.current?.setRangeFacets(active.buttonId, next);
      setActiveRangeCaptures(captureEngineRef.current?.getActiveRanges() ?? []);
      return;
    }
    setArmedFacets((current) => toggleFacetValue(board, current, facetGroupId, optionId));
  }, [activeRangeCaptures, board, boardMode]);

  const pressBoardButton = useCallback(async (buttonId: string) => {
    if (!board || !selectedVideo || busy) return;
    if (boardMode === 'retag') {
      if (!selectedClip) {
        setMessage(t('player.selectClipFirst'));
        setBoardMode('capture');
        return;
      }
      if (playing) {
        setMessage(t('player.pauseBeforeRetag'));
        return;
      }
      const selection = pruneInapplicableFacets(board, buttonId, {
        primary: buttonId,
        facets: armedFacetsRef.current,
      });
      await saveTags(selectedClip.id, selection);
      setArmedFacets((current) => {
        const next = { ...current };
        Object.keys(selection.facets).forEach((facetGroupId) => delete next[facetGroupId]);
        return next;
      });
      setBoardMode('capture');
      return;
    }

    const engine = captureEngineRef.current;
    if (!engine) return;
    try {
      const result = engine.pressButton(buttonId, presentedFrame);
      setActiveRangeCaptures(engine.getActiveRanges());
      if (result.kind === 'armed') {
        setMessage(t('player.rangeArmed', {
          label: result.range.buttonLabel,
          frame: formatNumber(result.range.startFrame),
        }));
      } else if (result.kind === 'waiting') {
        setMessage(t('player.rangeCloseHint', {
          frame: formatNumber(result.range.startFrame),
          label: result.range.buttonLabel,
        }));
      } else {
        await persistCapturedClip(result.clip);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [board, boardMode, busy, formatNumber, persistCapturedClip, playing, presentedFrame, saveTags, selectedClip, selectedVideo, t]);

  const createUntaggedClip = useCallback(async () => {
    if (!projectDir || !selectedVideo || !board || busy) return;
    if (untaggedStartFrame === null) {
      setUntaggedStartFrame(presentedFrame);
      setMessage(t('player.rangeArmed', {
        label: t('player.untaggedClip'),
        frame: formatNumber(presentedFrame),
      }));
      return;
    }
    const endFrame = Math.min(selectedVideo.frameCount, presentedFrame + 1);
    if (endFrame <= untaggedStartFrame) {
      setMessage(t('player.rangeCloseHint', {
        frame: formatNumber(untaggedStartFrame),
        label: t('player.untaggedClip'),
      }));
      return;
    }
    const startFrame = untaggedStartFrame;
    setUntaggedStartFrame(null);
    await persistCapturedClip({
      schema: 'clip.v2',
      id: makeId('clip'),
      videoId: selectedVideo.id,
      startFrame: videoFrame(startFrame),
      endFrame: frameBoundary(endFrame),
      label: 'Untagged clip',
      tags: createEmptyTaggingSelection(),
      pins: [],
      annotations: [],
    });
  }, [board, busy, formatNumber, persistCapturedClip, presentedFrame, projectDir, selectedVideo, t, untaggedStartFrame]);

  const toggleRetagMode = useCallback(() => {
    if (boardMode === 'retag') {
      setBoardMode('capture');
      setArmedFacets({});
      setMessage(t('player.retagCanceled'));
      return;
    }
    if (!selectedClip) {
      setMessage(t('player.selectBeforeRetag'));
      return;
    }
    if (playing) {
      setMessage(t('player.pauseBeforeRetag'));
      return;
    }
    setArmedFacets(structuredClone(selectedClip.tags.facets));
    setBoardMode('retag');
    setMessage(t('player.retagChoose', { label: selectedClip.label || selectedClip.id }));
  }, [boardMode, playing, selectedClip, t]);

  const deleteSelected = useCallback(async () => {
    if (!projectDir || !selectedClip) return;
    await runMutation(async () => {
      const record = await deleteClipExclusive(projectDir, selectedClip.id);
      setUndoDeletion(record);
      setLastCreatedClipId((current) => current === selectedClip.id ? null : current);
      setSelectedClipId(null);
      setMessage(t('player.deleted', { label: selectedClip.label || selectedClip.id }));
    });
  }, [projectDir, runMutation, selectedClip, t]);

  const undoCapture = useCallback(async () => {
    if (!projectDir || !lastCreatedClipId) return;
    const clipId = lastCreatedClipId;
    await runMutation(async () => {
      const record = await deleteClipExclusive(projectDir, clipId);
      setUndoDeletion(record);
      setLastCreatedClipId(null);
      setSelectedClipId((current) => current === clipId ? null : current);
      setMessage(t('player.lastCaptureRemoved'));
    });
  }, [lastCreatedClipId, projectDir, runMutation, t]);

  const undoDelete = useCallback(async () => {
    if (!projectDir || !undoDeletion) return;
    const record = undoDeletion;
    await runMutation(async () => {
      const restored = await restoreClipExclusive(projectDir, record.clipId, record.operationId);
      setUndoDeletion(null);
      setSelectedClipId(restored.id);
      setMessage(t('player.restored', { label: restored.label || restored.id }));
    });
  }, [projectDir, runMutation, t, undoDeletion]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const boardAction = hotkeys?.resolve(event);
      if (boardAction) {
        event.preventDefault();
        event.stopPropagation();
        if (boardAction.kind === 'button') void pressBoardButton(boardAction.buttonId);
        else toggleFacet(boardAction.facetGroupId, boardAction.optionId);
        return;
      }
      if (isTextEntryTarget(event.target)) return;
      if (event.key === 'Escape') {
        if (boardMode === 'retag') {
          event.preventDefault();
          setBoardMode('capture');
          setArmedFacets({});
          setMessage(t('player.retagCanceled'));
          return;
        }
        const canceled = captureEngineRef.current?.cancelMostRecentRange();
        if (canceled) {
          event.preventDefault();
          setActiveRangeCaptures(captureEngineRef.current?.getActiveRanges() ?? []);
          setMessage(t('player.rangeCanceled', { label: canceled.buttonLabel }));
          return;
        }
        if (untaggedStartFrame !== null) {
          event.preventDefault();
          setUntaggedStartFrame(null);
          setMessage(t('player.rangeCanceled', { label: t('player.untaggedClip') }));
          return;
        }
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedClip) {
        event.preventDefault();
        void deleteSelected();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && undoDeletion) {
        event.preventDefault();
        void undoDelete();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [boardMode, deleteSelected, hotkeys, pressBoardButton, selectedClip, t, toggleFacet, undoDelete, undoDeletion, untaggedStartFrame]);

  if (isRestoring) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted">{t('project.restore')}</div>;
  }
  if (!projectDir || !manifest || !board) {
    return (
      <div className="panel">
        <p className="status">{t('project.noOpen')}</p>
        <button onClick={() => router.push('/')}>{t('player.backProject')}</button>
      </div>
    );
  }
  if (!selectedVideo) {
    return (
      <div className="panel">
        <p className="status">{t('player.noVideo')}</p>
        <button onClick={() => router.push('/')}>{t('player.backProject')}</button>
      </div>
    );
  }

  return (
    <div className="fullbleed flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="capture-player">
      <nav className="workspace-bar">
        <button className="button-quiet border-r border-border" onClick={() => router.push('/')}>{t('player.project')}</button>
        <button className="button-quiet border-r border-border" onClick={() => router.push('/metadata')}>{t('project.matchInfo')}</button>
        <select
          aria-label={t('player.selectVideo')}
          className="border-0 border-r border-border bg-raised px-3 text-xs text-accent"
          value={selectedVideo.id}
          onChange={(event) => setSelectedVideoId(event.target.value)}
        >
          {manifest.videos.map((video) => <option key={video.id} value={video.id}>{video.label}</option>)}
        </select>
        <div className="flex flex-1 items-center px-3 font-mono text-xs text-secondary">
          {t('player.framePosition', {
            frame: formatNumber(presentedFrame),
            lastFrame: formatNumber(selectedVideo.frameCount - 1),
          })}
          {activeRangeCaptures.length > 0 && (
            <span className="ml-3 text-warning">
              {activeRangeCaptures.length === 1
                ? t('player.activeRangesOne')
                : t('player.activeRangesMany', { count: formatNumber(activeRangeCaptures.length) })}
            </span>
          )}
        </div>
        <button
          className="button-quiet"
          aria-pressed={untaggedStartFrame !== null}
          onClick={() => void createUntaggedClip()}
          disabled={busy}
        >
          {t('player.untaggedClip')}
        </button>
        <button onClick={toggleRetagMode} disabled={busy || !selectedClip || (playing && boardMode !== 'retag')}>
          {boardMode === 'retag' ? t('player.cancelRetag') : t('player.retagSelected')}
        </button>
        {lastCreatedClipId && <button onClick={() => void undoCapture()} disabled={busy}>{t('player.undoCapture')}</button>}
        {undoDeletion && <button onClick={() => void undoDelete()} disabled={busy}>{t('player.undoDelete')}</button>}
        <button
          className="button-primary"
          onClick={() => {
            if (selectedClip) {
              window.open(`/clip/${encodeURIComponent(selectedClip.id)}`, '_blank', 'noopener,noreferrer');
            }
          }}
          disabled={!selectedClip}
        >
          {t('player.openEditor')}
        </button>
        <button className="button-danger" onClick={() => void deleteSelected()} disabled={busy || !selectedClip}>{t('player.deleteClip')}</button>
      </nav>

      <Panels
        autoSaveId="annotate:player:video-tagging"
        direction="horizontal"
        className="flex-1"
        data-testid="player-panel-group-horizontal"
      >
        <Panel id="player-video" defaultSize={64} minSize={38}>
          <VideoPlayerUnit
            ref={setPlayer}
            className="h-full"
            src={videoUrl}
            fps={selectedVideo.fps}
            frameCount={selectedVideo.frameCount}
            ranges={timelineRanges}
            timelineLanes={timelineLanes}
            selectedRangeId={selectedClipId}
            onSelectRange={(clipId, startFrame) => {
              setSelectedClipId(clipId);
              player?.seekFrame(startFrame);
            }}
            onPresentedFrameChange={setPresentedFrame}
            onPlayingChange={(nextPlaying) => {
              setPlaying(nextPlaying);
              if (nextPlaying && boardMode === 'retag') {
                setBoardMode('capture');
                setArmedFacets({});
                setMessage(t('player.retagCanceledPlayback'));
              }
            }}
            locked={busy}
          />
        </Panel>
        <PanelResizeHandle direction="horizontal" data-testid="player-main-resize-handle" />
        <Panel id="player-tagging" defaultSize={36} minSize={28} maxSize={58}>
          <Panels
            autoSaveId="annotate:player:tag-board-clip-tree"
            direction="vertical"
            data-testid="player-panel-group-vertical"
          >
            <Panel id="player-tag-board" defaultSize={62} minSize={32}>
              <TagBoard
                board={board}
                armedFacets={armedFacets}
                activeRangeCaptures={activeRangeCaptures}
                mode={boardMode}
                disabled={busy}
                onButtonPress={pressBoardButton}
                onFacetToggle={toggleFacet}
              />
            </Panel>
            <PanelResizeHandle direction="vertical" data-testid="player-tagging-resize-handle" />
            <Panel id="player-clip-tree" defaultSize={38} minSize={20}>
              <section className="flex h-full min-h-0 flex-col">
                <div className="panel-heading">
                  <h2>{t('project.clips')}</h2>
                  <span className="font-mono text-[10px] text-muted">{formatNumber(videoClips.length)}</span>
                </div>
                <ClipTagTree
                  board={board}
                  clips={videoClips}
                  selectedClipId={selectedClipId}
                  onSelectClip={selectClip}
                  onDropClipOnButton={(clipId, buttonId) => saveTags(clipId, {
                    ...(clips.find((clip) => clip.id === clipId)?.tags ?? createEmptyTaggingSelection()),
                    primary: buttonId,
                  })}
                />
              </section>
            </Panel>
          </Panels>
        </Panel>
      </Panels>

      {message && (
        <div role="status" className="shrink-0 border-t border-border bg-raised px-3 py-2 text-xs text-secondary">
          {message}
        </div>
      )}
    </div>
  );
}
