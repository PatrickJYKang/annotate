"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { frameBoundary, frameToMs, videoFrame } from '../../lib/clip/frameMath';
import { registerVideoFile, requestExactMotionEncode, unregisterVideoRef } from '../../lib/clip/sidecarClient';
import { listClips } from '../../lib/fs/clipStorage';
import { getFilePath, splitSafeRelativePath } from '../../lib/fs/fsAccess';
import {
  preparedPresentationAssetKey,
  readPreparedPresentationAssetFile,
  readPresentationMediaIndex,
  writePreparedPresentationAsset,
  type PreparedPresentationAssetKind,
} from '../../lib/fs/presentationMedia';
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
  transitionOwnerId,
  type PreparedPresentationResource,
  type PresentationScene,
  type PresentationVideoResource,
} from './PresentationCanvas';
import PresentationDeck from './PresentationDeck';
import PresentationInspector from './PresentationInspector';
import { useLocale } from '../../lib/i18n';

interface PresentationAuthoringEditorProps {
  projectDir: FileSystemDirectoryHandle;
  manifest: ProjectManifest;
  board: TaggingBoard;
  presentation: Presentation;
  onBack: () => void;
}

type ExactRequest = {
  kind: PreparedPresentationAssetKind;
  ownerId: string;
  videoId: string;
  startFrame: number;
  endFrame: number;
};

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
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [isPresenting, setIsPresenting] = useState(false);
  const [presentScene, setPresentScene] = useState<PresentationScene>({ kind: 'slide', index: 0 });
  const [videoResources, setVideoResources] = useState<Map<string, PresentationVideoResource>>(new Map());
  const [preparedResources, setPreparedResources] = useState<Map<string, PreparedPresentationResource>>(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeTailRef = useRef<Promise<void>>(Promise.resolve());
  const preparedUrlsRef = useRef<string[]>([]);
  const videoUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    let active = true;
    void listClips(projectDir).then((result) => {
      if (!active) return;
      setClips(result.clips);
      if (result.errors.length) setMessage(result.errors.map((entry) => entry.error.message).join(' '));
    });
    return () => { active = false; };
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

  const reloadPreparedResources = useCallback(async () => {
    const index = await readPresentationMediaIndex(projectDir, draftRef.current.id);
    const resources = new Map<string, PreparedPresentationResource>();
    const urls: string[] = [];
    for (const entry of index.assets) {
      try {
        const file = await readPreparedPresentationAssetFile(projectDir, draftRef.current.id, entry);
        const url = URL.createObjectURL(file);
        urls.push(url);
        resources.set(entry.key, { entry, url });
      } catch {
      }
    }
    preparedUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    preparedUrlsRef.current = urls;
    setPreparedResources(resources);
  }, [projectDir]);

  useEffect(() => {
    void reloadPreparedResources().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
    return () => {
      preparedUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      preparedUrlsRef.current = [];
    };
  }, [reloadPreparedResources]);

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

  const updateSlide = useCallback((slide: PresentationSlide) => {
    const slides = draftRef.current.slides.map((candidate, index) => index === selectedIndex ? slide : candidate);
    commit(withUpdatedPresentation(draftRef.current, slides));
  }, [commit, selectedIndex]);

  const insertAsset = useCallback((payload: PresentationAssetDrag, index: number) => {
    const slide = payload.kind === 'clip'
      ? createClipSlide(payload.clipId)
      : createPinSlide(payload.clipId, payload.pinId);
    commit(insertSlide(draftRef.current, slide, index), true);
    setSelectedIndex(index);
  }, [commit]);

  const moveSlide = useCallback((fromIndex: number, toIndex: number) => {
    commit(movePresentationSlide(draftRef.current, fromIndex, toIndex), true);
    setSelectedIndex(Math.max(0, Math.min(draftRef.current.slides.length - 1, toIndex)));
  }, [commit]);

  const deleteSelected = useCallback(() => {
    commit(removeSlide(draftRef.current, selectedIndex), true);
    setSelectedIndex((index) => Math.max(0, Math.min(index, draftRef.current.slides.length - 1)));
  }, [commit, selectedIndex]);

  const prepareRequests = useCallback(async (requests: ExactRequest[]) => {
    if (requests.length === 0) return;
    setPreparing(true);
    setMessage(t('presentation.mediaPreparing'));
    const refs = new Map<string, string>();
    try {
      const currentIndex = await readPresentationMediaIndex(projectDir, draftRef.current.id);
      for (let index = 0; index < requests.length; index += 1) {
        const request = requests[index]!;
        const key = preparedPresentationAssetKey({
          kind: request.kind,
          ownerId: request.ownerId,
          videoId: request.videoId,
          sourceStartFrame: request.startFrame,
          sourceEndFrame: request.endFrame,
        });
        const indexed = currentIndex.assets.find((entry) => entry.key === key);
        if (indexed) {
          try {
            await readPreparedPresentationAssetFile(projectDir, draftRef.current.id, indexed);
            continue;
          } catch {
            // Regenerate when an index entry outlives its derived media file.
          }
        }
        const resource = videoResources.get(request.videoId);
        if (!resource) throw new Error(t('presentation.mediaUnavailable', { id: request.videoId }));
        let videoRef = refs.get(request.videoId);
        if (!videoRef) {
          videoRef = (await registerVideoFile(resource.file)).videoRef;
          refs.set(request.videoId, videoRef);
        }
        setMessage(t('presentation.mediaProgress', {
          current: formatNumber(index + 1),
          total: formatNumber(requests.length),
        }));
        const blob = await requestExactMotionEncode({
          videoRef,
          startMs: Number(frameToMs(videoFrame(request.startFrame), resource.video.fps)),
          endMs: Number(frameToMs(frameBoundary(request.endFrame), resource.video.fps)),
        });
        await writePreparedPresentationAsset(projectDir, draftRef.current.id, {
          kind: request.kind,
          ownerId: request.ownerId,
          videoId: request.videoId,
          sourceStartFrame: videoFrame(request.startFrame),
          sourceEndFrame: frameBoundary(request.endFrame),
        }, blob);
      }
      await reloadPreparedResources();
      setMessage(t('presentation.exactReady'));
    } finally {
      await Promise.all(Array.from(refs.values()).map((videoRef) => unregisterVideoRef(videoRef).catch(() => undefined)));
      setPreparing(false);
    }
  }, [formatNumber, projectDir, reloadPreparedResources, t, videoResources]);

  const collectExactRequests = useCallback((target: Presentation): ExactRequest[] => {
    const requests: ExactRequest[] = [];
    for (const slide of target.slides) {
      if (slide.kind !== 'clip') continue;
      const clip = clips.find((candidate) => candidate.id === slide.clipId);
      if (!clip) continue;
      requests.push({ kind: 'clip_slide', ownerId: slide.id, videoId: clip.videoId, startFrame: clip.startFrame, endFrame: clip.endFrame });
    }
    target.transitions.forEach((transition, index) => {
      if (transition.mode !== 'match_video') return;
      const from = target.slides[index];
      const to = target.slides[index + 1];
      if (!from || !to) return;
      const valid = validateMatchVideoEdge(from, to, transition, clips, manifest);
      if (!valid.ok) throw new Error(t(`presentation.validation.${valid.code}`));
      requests.push({
        kind: 'transition',
        ownerId: transitionOwnerId(from, to),
        videoId: valid.video.id,
        startFrame: valid.range.startFrame,
        endFrame: valid.range.endFrame,
      });
    });
    return requests;
  }, [clips, manifest, t]);

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
        return;
      }
      void prepareRequests([{
        kind: 'transition',
        ownerId: transitionOwnerId(from, to),
        videoId: valid.video.id,
        startFrame: valid.range.startFrame,
        endFrame: valid.range.endFrame,
      }]).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
    }
  }, [clips, commit, manifest, prepareRequests, selectedIndex, t]);

  const beginPresenting = useCallback(async () => {
    if (draftRef.current.slides.length === 0) {
      setMessage(t('presentation.addSlideFirst'));
      return;
    }
    try {
      await prepareRequests(collectExactRequests(draftRef.current));
      setPresentScene({ kind: 'slide', index: 0 });
      setIsPresenting(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [collectExactRequests, prepareRequests, t]);

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
      else if (event.key === 'ArrowRight') advanceScene();
      else if (event.key === 'ArrowLeft') previousScene();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advanceScene, isPresenting, previousScene]);

  const previewClip = useCallback((clipId: string) => {
    const index = draftRef.current.slides.findIndex((slide) => slide.kind !== 'title' && slide.clipId === clipId);
    if (index >= 0) setSelectedIndex(index);
  }, []);

  const authoringScene: PresentationScene = { kind: 'slide', index: selectedIndex };
  const selectedClipId = selectedSlide && selectedSlide.kind !== 'title' ? selectedSlide.clipId : null;

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
          setSelectedIndex(index);
        }}>{t('presentation.addTitle')}</button>
        <span className="flex-1" />
        <span className="flex items-center px-3 text-xs text-muted">{saveState === 'dirty' ? t('presentation.unsaved') : saveState === 'saving' ? t('presentation.saving') : saveState === 'saved' ? t('presentation.saved') : saveState === 'error' ? t('presentation.saveFailed') : ''}</span>
        <button className="button-primary border-y-0 border-r-0" disabled={preparing || draft.slides.length === 0} onClick={() => void beginPresenting()}>{preparing ? t('presentation.mediaPreparingShort') : t('presentation.present')}</button>
      </header>
      <Panels
        autoSaveId="annotate:presentation:assets-canvas-inspector"
        direction="horizontal"
        className="flex-1"
        data-testid="presentation-panel-group-horizontal"
      >
        <Panel id="presentation-assets-panel" defaultSize={20} minSize={13} maxSize={36}>
          <PresentationAssetBrowser index={assetIndex} selectedClipId={selectedClipId} onPreviewClip={previewClip} />
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
                {selectedSlide ? (
                  <PresentationCanvas
                    projectDir={projectDir}
                    manifest={manifest}
                    presentation={draft}
                    clips={clips}
                    scene={authoringScene}
                    videoResources={videoResources}
                    preparedResources={preparedResources}
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
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
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
            transitionAfter={transitionAfter}
            transitionError={transitionError}
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
              projectDir={projectDir}
              manifest={manifest}
              presentation={draft}
              clips={clips}
              scene={presentScene}
              videoResources={videoResources}
              preparedResources={preparedResources}
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
            <button onClick={advanceScene}>{t('presentation.next')}</button>
            <button onClick={() => setIsPresenting(false)}>{t('presentation.exit')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
