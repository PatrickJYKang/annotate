"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listClips } from '../../lib/fs/clipStorage';
import { subscribeToClipChanges } from '../../lib/fs/clipEvents';
import { getFilePath, splitSafeRelativePath } from '../../lib/fs/fsAccess';
import { writePresentation } from '../../lib/fs/presentationStorage';
import {
  buildPresentationAssetIndex,
  createClipSlide,
  createPinSlide,
  createTitleSlide,
  insertSlide,
  moveSlide as movePresentationSlide,
  removeSlide,
  validateMatchVideoEdge,
  withUpdatedPresentation,
} from '../../lib/presentation/authoring';
import type { PresentationAssetDrag } from '../../lib/presentation/drag';
import type { TaggingBoard } from '../../lib/tagging/board';
import type { Clip } from '../../lib/types/clip';
import type { PresentationSlide, PresentationTransition, Presentation } from '../../lib/types/presentation';
import type { ProjectManifest } from '../../lib/types/project';
import {
  Panel,
  PanelResizeHandle,
  Panels,
} from '../panels/Panels';
import PresentationAssetBrowser from './PresentationAssetBrowser';
import PresentationCanvas, {
  type PresentationCanvasHandle,
  type PresentationScene,
  type PresentationVideoResource,
} from './PresentationCanvas';
import PresentationDeck from './PresentationDeck';
import PresentationInspector, { type PresentationSourcePreview } from './PresentationInspector';
import { useLocale } from '../../lib/i18n';

interface PresentationAuthoringEditorProps {
  projectDir: FileSystemDirectoryHandle;
  manifest: ProjectManifest;
  board: TaggingBoard;
  presentation: Presentation;
  onBack: () => void;
}

export default function PresentationAuthoringEditor({
  projectDir,
  manifest,
  board,
  presentation,
  onBack,
}: PresentationAuthoringEditorProps) {
  const { t, formatNumber } = useLocale();
  const [draft, setDraft] = useState(presentation);
  const draftRef = useRef(presentation);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [previewSource, setPreviewSource] = useState<PresentationAssetDrag | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [isPresenting, setIsPresenting] = useState(false);
  const [presentScene, setPresentScene] = useState<PresentationScene>({ kind: 'slide', index: 0 });
  const [videoResources, setVideoResources] = useState<Map<string, PresentationVideoResource>>(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeTailRef = useRef<Promise<void>>(Promise.resolve());
  const videoUrlsRef = useRef<string[]>([]);
  const presentCanvasRef = useRef<PresentationCanvasHandle | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const result = await listClips(projectDir);
      if (!active) return;
      setClips(result.clips);
      if (result.errors.length) setMessage(result.errors.map((entry) => entry.error.message).join(' '));
    };
    void load();
    const refreshAfterClipEdit = () => void load();
    const unsubscribeClipChanges = subscribeToClipChanges(() => void load());
    window.addEventListener('focus', refreshAfterClipEdit);
    return () => {
      active = false;
      unsubscribeClipChanges();
      window.removeEventListener('focus', refreshAfterClipEdit);
    };
  }, [projectDir]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    void (async () => {
      const resources = new Map<string, PresentationVideoResource>();
      for (const video of manifest.videos) {
        const file = await getFilePath(projectDir, splitSafeRelativePath(video.file), false).then((handle) => handle.getFile());
        const url = URL.createObjectURL(file);
        urls.push(url);
        resources.set(video.id, { video, file, url });
      }
      if (!active) return;
      videoUrlsRef.current = urls;
      setVideoResources(resources);
    })().catch((error) => active && setMessage(error instanceof Error ? error.message : String(error)));
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [manifest.videos, projectDir]);

  const persistLatest = useCallback(() => {
    const target = draftRef.current;
    setSaveState('saving');
    writeTailRef.current = writeTailRef.current
      .then(() => writePresentation(projectDir, target))
      .then(() => {
        if (draftRef.current === target) setSaveState('saved');
      })
      .catch((error) => {
        setSaveState('error');
        setMessage(error instanceof Error ? error.message : String(error));
      });
  }, [projectDir]);

  const commit = useCallback((next: Presentation, immediate = false) => {
    draftRef.current = next;
    setDraft(next);
    setSaveState('dirty');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (immediate) persistLatest();
    else saveTimerRef.current = setTimeout(persistLatest, 300);
  }, [persistLatest]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    void writePresentation(projectDir, draftRef.current).catch(() => undefined);
  }, [projectDir]);

  const assetIndex = useMemo(
    () => buildPresentationAssetIndex(board, manifest, clips),
    [board, clips, manifest],
  );
  const selectedSlide = draft.slides[selectedIndex] ?? null;
  const selectedClip = selectedSlide && selectedSlide.kind !== 'title'
    ? clips.find((clip) => clip.id === selectedSlide.clipId) ?? null
    : null;
  const transitionAfter = draft.transitions[selectedIndex] ?? null;
  const transitionValidation = selectedSlide && transitionAfter?.mode === 'match_video'
    ? validateMatchVideoEdge(selectedSlide, draft.slides[selectedIndex + 1]!, transitionAfter, clips, manifest)
    : null;
  const transitionError = transitionValidation && !transitionValidation.ok
    ? t(`presentation.validation.${transitionValidation.code}`)
    : null;
  const previewSlide = useMemo(() => {
    if (!previewSource) return null;
    return previewSource.kind === 'clip'
      ? createClipSlide(previewSource.clipId, `preview-clip-${previewSource.clipId}`)
      : createPinSlide(previewSource.clipId, previewSource.pinId, `preview-pin-${previewSource.clipId}-${previewSource.pinId}`);
  }, [previewSource]);
  const canvasPresentation = useMemo<Presentation>(() => (
    previewSlide
      ? { ...draft, slides: [previewSlide], transitions: [] }
      : draft
  ), [draft, previewSlide]);
  const sourcePreview = useMemo<PresentationSourcePreview | null>(() => {
    if (!previewSource) return null;
    const clip = clips.find((candidate) => candidate.id === previewSource.clipId);
    if (!clip) return null;
    return {
      kind: previewSource.kind,
      clip,
      pin: previewSource.kind === 'pin'
        ? clip.pins.find((candidate) => candidate.id === previewSource.pinId) ?? null
        : null,
      video: manifest.videos.find((candidate) => candidate.id === clip.videoId) ?? null,
    };
  }, [clips, manifest.videos, previewSource]);

  const updateSlide = useCallback((slide: PresentationSlide) => {
    const slides = draftRef.current.slides.map((candidate, index) => index === selectedIndex ? slide : candidate);
    commit(withUpdatedPresentation(draftRef.current, slides));
  }, [commit, selectedIndex]);

  const insertAsset = useCallback((payload: PresentationAssetDrag, index: number) => {
    const slide = payload.kind === 'clip'
      ? createClipSlide(payload.clipId)
      : createPinSlide(payload.clipId, payload.pinId);
    commit(insertSlide(draftRef.current, slide, index), true);
    setPreviewSource(null);
    setSelectedIndex(index);
  }, [commit]);

  const moveSlide = useCallback((fromIndex: number, toIndex: number) => {
    commit(movePresentationSlide(draftRef.current, fromIndex, toIndex), true);
    setPreviewSource(null);
    setSelectedIndex(Math.max(0, Math.min(draftRef.current.slides.length - 1, toIndex)));
  }, [commit]);

  const deleteSelected = useCallback(() => {
    commit(removeSlide(draftRef.current, selectedIndex), true);
    setPreviewSource(null);
    setSelectedIndex((index) => Math.max(0, Math.min(index, draftRef.current.slides.length - 1)));
  }, [commit, selectedIndex]);

  const updateTransition = useCallback((transition: PresentationTransition) => {
    const transitions = draftRef.current.transitions.map((candidate, index) => index === selectedIndex ? transition : candidate);
    const next = { ...draftRef.current, transitions, updatedAt: new Date().toISOString() };
    commit(next, true);
    if (transition.mode === 'match_video') {
      const from = next.slides[selectedIndex];
      const to = next.slides[selectedIndex + 1];
      if (!from || !to) return;
      const valid = validateMatchVideoEdge(from, to, transition, clips, manifest);
      if (!valid.ok) {
        setMessage(t(`presentation.validation.${valid.code}`));
      }
    }
  }, [clips, commit, manifest, selectedIndex, t]);

  const beginPresenting = useCallback(() => {
    if (draftRef.current.slides.length === 0) {
      setMessage(t('presentation.addSlideFirst'));
      return;
    }
    setPresentScene({ kind: 'slide', index: 0 });
    setIsPresenting(true);
  }, [t]);

  const advanceScene = useCallback(() => {
    setPresentScene((current) => {
      if (current.kind === 'transition') return { kind: 'slide', index: current.index + 1 };
      const transition = draftRef.current.transitions[current.index];
      if (transition?.mode === 'match_video') return { kind: 'transition', index: current.index };
      if (current.index + 1 < draftRef.current.slides.length) return { kind: 'slide', index: current.index + 1 };
      setMessage(t('presentation.complete'));
      return current;
    });
  }, [t]);

  const advancePresentation = useCallback(() => {
    if (presentCanvasRef.current?.advance()) return;
    advanceScene();
  }, [advanceScene]);

  const previousScene = useCallback(() => {
    setPresentScene((current) => {
      const index = current.kind === 'transition' ? current.index : Math.max(0, current.index - 1);
      return { kind: 'slide', index };
    });
  }, []);

  useEffect(() => {
    if (!isPresenting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPresenting(false);
      else if (event.key === 'ArrowRight') advancePresentation();
      else if (event.key === 'ArrowLeft') previousScene();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advancePresentation, isPresenting, previousScene]);

  const authoringScene: PresentationScene = { kind: 'slide', index: previewSlide ? 0 : selectedIndex };
  const authoringCanvasKey = previewSlide
    ? `preview-${previewSlide.id}`
    : `slide-${selectedSlide?.id ?? selectedIndex}`;
  const presentCanvasKey = presentScene.kind === 'slide'
    ? `slide-${draft.slides[presentScene.index]?.id ?? presentScene.index}`
    : `transition-${presentScene.index}-${draft.slides[presentScene.index]?.id ?? 'missing'}-${draft.slides[presentScene.index + 1]?.id ?? 'missing'}`;

  const selectDeckSlide = useCallback((index: number) => {
    setPreviewSource(null);
    setSelectedIndex(index);
  }, []);

  const openClipEditor = useCallback((clipId: string) => {
    window.open(`/clip/${encodeURIComponent(clipId)}`, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="presentation-editor">
      <header className="workspace-bar text-sm">
        <button className="button-quiet border-r border-border px-4" onClick={onBack}>{t('presentation.back')}</button>
        <input
          className="min-w-[260px] border-0 border-r border-solid border-border bg-transparent px-3 font-semibold"
          aria-label={t('presentation.name')}
          value={draft.name}
          onChange={(event) => commit({ ...draftRef.current, name: event.target.value || 'Untitled presentation', updatedAt: new Date().toISOString() })}
        />
        <button className="button-quiet border-r border-border px-3" onClick={() => {
          const slide = createTitleSlide('section');
          const index = Math.min(draftRef.current.slides.length, selectedIndex + 1);
          commit(insertSlide(draftRef.current, slide, index), true);
          setPreviewSource(null);
          setSelectedIndex(index);
        }}>{t('presentation.addTitle')}</button>
        <span className="flex-1" />
        <span className="flex items-center px-3 text-xs text-muted">{saveState === 'dirty' ? t('presentation.unsaved') : saveState === 'saving' ? t('presentation.saving') : saveState === 'saved' ? t('presentation.saved') : saveState === 'error' ? t('presentation.saveFailed') : ''}</span>
        <button className="button-primary border-y-0 border-r-0" disabled={draft.slides.length === 0} onClick={beginPresenting}>{t('presentation.present')}</button>
      </header>
      <Panels
        autoSaveId="annotate:presentation:assets-canvas-inspector"
        direction="horizontal"
        className="flex-1"
        data-testid="presentation-panel-group-horizontal"
      >
        <Panel id="presentation-assets-panel" defaultSize={20} minSize={13} maxSize={36}>
          <PresentationAssetBrowser index={assetIndex} selectedAsset={previewSource} onPreviewAsset={setPreviewSource} />
        </Panel>
        <PanelResizeHandle direction="horizontal" data-testid="presentation-assets-resize-handle" />
        <Panel id="presentation-canvas-deck" defaultSize={60} minSize={34}>
          <Panels
            autoSaveId="annotate:presentation:canvas-deck"
            direction="vertical"
            data-testid="presentation-panel-group-vertical"
          >
            <Panel id="presentation-canvas-panel" defaultSize={76} minSize={38}>
              <main className="h-full min-h-0 min-w-0 bg-black">
                {canvasPresentation.slides.length > 0 ? (
                  <PresentationCanvas
                    key={authoringCanvasKey}
                    projectDir={projectDir}
                    manifest={manifest}
                    presentation={canvasPresentation}
                    clips={clips}
                    scene={authoringScene}
                    videoResources={videoResources}
                    isPresenting={false}
                    onComplete={() => undefined}
                  />
                ) : (
                  <div className="empty-state h-full border-0" aria-hidden="true" />
                )}
              </main>
            </Panel>
            <PanelResizeHandle direction="vertical" data-testid="presentation-deck-resize-handle" />
            <Panel id="presentation-deck-panel" defaultSize={24} minSize={14} maxSize={48}>
              <PresentationDeck
                slides={draft.slides}
                clips={clips}
                videoResources={videoResources}
                selectedIndex={previewSource ? -1 : selectedIndex}
                onSelect={selectDeckSlide}
                onInsertAsset={insertAsset}
                onMoveSlide={moveSlide}
              />
            </Panel>
          </Panels>
        </Panel>
        <PanelResizeHandle direction="horizontal" data-testid="presentation-inspector-resize-handle" />
        <Panel id="presentation-inspector-panel" defaultSize={20} minSize={15} maxSize={38}>
          <PresentationInspector
            slide={selectedSlide}
            clip={selectedClip}
            sourcePreview={sourcePreview}
            transitionAfter={transitionAfter}
            transitionError={transitionError}
            onEditClip={openClipEditor}
            onSlideChange={updateSlide}
            onTransitionChange={updateTransition}
            onDelete={deleteSelected}
          />
        </Panel>
      </Panels>
      {message && <div className="toast max-w-md" role="status">{message}</div>}

      {isPresenting && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black" data-testid="presentation-present">
          <div className="min-h-0 flex-1">
            <PresentationCanvas
              ref={presentCanvasRef}
              key={presentCanvasKey}
              projectDir={projectDir}
              manifest={manifest}
              presentation={draft}
              clips={clips}
              scene={presentScene}
              videoResources={videoResources}
              isPresenting
              onComplete={advanceScene}
            />
          </div>
          <div className="flex shrink-0 items-center justify-center gap-2 border-t border-white/10 bg-black px-3 py-2 text-xs text-white">
            <button onClick={previousScene}>{t('presentation.previous')}</button>
            <span>{presentScene.kind === 'transition'
              ? t('presentation.transition', { number: formatNumber(presentScene.index + 1) })
              : t('presentation.slidePosition', {
                current: formatNumber(presentScene.index + 1),
                total: formatNumber(draft.slides.length),
              })}</span>
            <button onClick={advancePresentation}>{t('presentation.next')}</button>
            <button onClick={() => setIsPresenting(false)}>{t('presentation.exit')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
