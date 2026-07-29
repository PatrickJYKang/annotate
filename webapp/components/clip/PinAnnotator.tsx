"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import AnnotateToolbar from '../annotate/AnnotateToolbar';
import Editor, { type StrokePattern, type Tool } from '../annotate/Editor';
import { projectPitchBoundsToPerspectiveQuad } from '../../lib/annotate/pitchCalibration';
import {
  frameBoundary,
  frameToCenterSeconds,
  frameToMs,
  mediaTimeToVideoFrame,
  sidecarSampleEndMs,
  videoFrame,
} from '../../lib/clip/frameMath';
import { resolveUsableHomographyAtTime } from '../../lib/clip/homographyInterpolation';
import { requestHomography } from '../../lib/clip/sidecarClient';
import {
  createPinAnnotationExclusive,
  deletePinAnnotationExclusive,
  pinAnnotationPath,
  restorePinAnnotationExclusive,
  savePinAnnotationExclusive,
} from '../../lib/fs/pinAnnotationStorage';
import type { TrashOperationRecord } from '../../lib/fs/trash';
import type { AnnotationDocument } from '../../lib/annotate/documentPayload';
import {
  defaultAnnotationFontSize,
  defaultAnnotationStrokeWidth,
} from '../../lib/annotate/styleScale';
import { parseAnnotations, type Annotations } from '../../lib/types/annotations';
import type { ClipPin, Clip } from '../../lib/types/clip';
import type { VideoEntry } from '../../lib/types/project';
import { useLocale } from '../../lib/i18n';

interface PinAnnotatorProps {
  projectDir: FileSystemDirectoryHandle;
  clip: Clip;
  pin: ClipPin;
  video: VideoEntry;
  sourceVideoRef: RefObject<HTMLVideoElement>;
  videoRef?: string;
  onClipUpdate: (clip: Clip) => void;
  onImportDocument: (annotationId: string) => Promise<void>;
  onClose: () => void;
}

type SaveStatus = { state: 'idle' | 'saving' | 'saved' | 'error'; at?: string; message?: string };

function makeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function emptyPinDocument(
  clip: Clip,
  pin: ClipPin,
  annotationId: string,
  video: VideoEntry,
): Annotations {
  return {
    schema: 'annotations.v2',
    annotationId,
    clipId: clip.id,
    pinId: pin.id,
    frame: pin.frame,
    image: { width: video.width, height: video.height },
    shapes: [],
  };
}

export default function PinAnnotator({
  projectDir,
  clip,
  pin,
  video,
  sourceVideoRef,
  videoRef,
  onClipUpdate,
  onImportDocument,
  onClose,
}: PinAnnotatorProps) {
  const { t, formatNumber } = useLocale();
  const [activeClip, setActiveClip] = useState(clip);
  const activePin = activeClip.pins.find((candidate) => candidate.id === pin.id) ?? pin;
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(activePin.annotations[0]?.id ?? '');
  const selectedReference = activePin.annotations.find((reference) => reference.id === selectedAnnotationId)
    ?? activePin.annotations[0]
    ?? null;
  const [tool, setTool] = useState<Tool>('select');
  const [strokePattern, setStrokePattern] = useState<StrokePattern>('solid');
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [fillColor, setFillColor] = useState('#000000');
  const [colorsLinked, setColorsLinked] = useState(true);
  const [strokeWidth, setStrokeWidth] = useState(() => defaultAnnotationStrokeWidth(video.width, video.height));
  const [fillOpacity, setFillOpacity] = useState(0.3);
  const [fontSize, setFontSize] = useState(() => defaultAnnotationFontSize(video.width, video.height));
  const [textHighlight, setTextHighlight] = useState(false);
  const [saveTick, setSaveTick] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'idle' });
  const [editorReady, setEditorReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creatingSet, setCreatingSet] = useState(false);
  const [newSetLabel, setNewSetLabel] = useState('');
  const [deletedAnnotation, setDeletedAnnotation] = useState<TrashOperationRecord | null>(null);
  const [pendingImportId, setPendingImportId] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [autoPerspectiveQuad, setAutoPerspectiveQuad] = useState<Array<{ x: number; y: number }> | null>(null);
  const [autoPerspectiveTick, setAutoPerspectiveTick] = useState(0);
  const [clearPerspectiveTick, setClearPerspectiveTick] = useState(0);
  const [hasHomography, setHasHomography] = useState(false);
  const [showHomography, setShowHomography] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewFrame, setPreviewFrame] = useState<number>(pin.frame);
  const [previewTick, setPreviewTick] = useState(0);
  const [stageScale, setStageScale] = useState(1);
  const [stageOffset, setStageOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previewDirectionRef = useRef<-1 | 0 | 1>(0);
  const previewRafRef = useRef<number | null>(null);
  const previewLastTsRef = useRef<number | null>(null);
  const panRef = useRef<{ pointerId: number; x: number; y: number; offset: { x: number; y: number } } | null>(null);

  const previewRadiusFrames = Math.max(1, Math.round(video.fps * 5));
  const previewBounds = useMemo(() => ({
    startFrame: Math.max(0, pin.frame - previewRadiusFrames),
    endFrame: Math.min(video.frameCount - 1, pin.frame + previewRadiusFrames),
  }), [pin.frame, previewRadiusFrames, video.frameCount]);
  const annotationsLocked = previewFrame !== pin.frame;
  const handleEditorReady = useCallback(() => setEditorReady(true), []);

  useEffect(() => {
    setEditorReady(false);
  }, [selectedReference?.id]);

  const updateClip = useCallback((next: Clip) => {
    setActiveClip(next);
    onClipUpdate(next);
  }, [onClipUpdate]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const fit = () => {
      const rect = container.getBoundingClientRect();
      const scale = Math.max(0.05, Math.min(rect.width / video.width, rect.height / video.height));
      setStageScale(scale);
      setStageOffset({
        x: (rect.width - video.width * scale) / 2,
        y: (rect.height - video.height * scale) / 2,
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [video.height, video.width]);

  const createSet = useCallback(async () => {
    const annotationId = makeId('annotation');
    try {
      const next = await createPinAnnotationExclusive(
        projectDir,
        emptyPinDocument(activeClip, activePin, annotationId, video),
        { label: newSetLabel.trim() || undefined },
      );
      updateClip(next);
      setSelectedAnnotationId(annotationId);
      setCreatingSet(false);
      setNewSetLabel('');
      setMessage(t('pin.annotationCreated'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [activeClip, activePin, newSetLabel, projectDir, t, updateClip, video]);

  const deleteSet = useCallback(async () => {
    if (!selectedReference || activePin.annotations.length <= 1) return;
    try {
      const record = await deletePinAnnotationExclusive(
        projectDir,
        activeClip.id,
        activePin.id,
        selectedReference.id,
      );
      const next = {
        ...activeClip,
        pins: activeClip.pins.map((candidate) => candidate.id === activePin.id
          ? { ...candidate, annotations: candidate.annotations.filter((reference) => reference.id !== selectedReference.id) }
          : candidate),
      };
      updateClip(next);
      setSelectedAnnotationId(next.pins.find((candidate) => candidate.id === activePin.id)?.annotations[0]?.id ?? '');
      setDeletedAnnotation(record);
      setMessage(t('pin.annotationMovedTrash'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [activeClip, activePin, projectDir, selectedReference, t, updateClip]);

  const undoDeleteSet = useCallback(async () => {
    if (!deletedAnnotation) return;
    try {
      const next = await restorePinAnnotationExclusive(
        projectDir,
        activeClip.id,
        activePin.id,
        deletedAnnotation.entityId,
        deletedAnnotation.operationId,
      );
      updateClip(next);
      setSelectedAnnotationId(deletedAnnotation.entityId);
      setDeletedAnnotation(null);
      setMessage(t('pin.annotationRestored'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [activeClip.id, activePin.id, deletedAnnotation, projectDir, t, updateClip]);

  const persistDocument = useCallback(async (document: AnnotationDocument) => {
    const parsed = parseAnnotations(document);
    await savePinAnnotationExclusive(projectDir, parsed);
  }, [projectDir]);

  useEffect(() => {
    if (!pendingImportId || saveStatus.state !== 'saved') return;
    const annotationId = pendingImportId;
    setPendingImportId(null);
    void onImportDocument(annotationId).then(
      () => setMessage(t('pin.annotationImported')),
      (error) => setMessage(error instanceof Error ? error.message : String(error)),
    );
  }, [onImportDocument, pendingImportId, saveStatus.state, t]);

  const requestImport = useCallback(() => {
    if (!selectedReference || !editorReady) return;
    setSaveStatus({ state: 'saving', message: 'import_pending' });
    setPendingImportId(selectedReference.id);
    setSaveTick((tick) => tick + 1);
  }, [editorReady, selectedReference]);

  const syncPreviewFrame = useCallback(() => {
    const element = sourceVideoRef.current;
    if (!element) return;
    const frame = mediaTimeToVideoFrame(element.currentTime, video.fps, video.frameCount);
    const clamped = Math.max(previewBounds.startFrame, Math.min(previewBounds.endFrame, frame));
    if (frame !== clamped) element.currentTime = frameToCenterSeconds(videoFrame(clamped), video.fps);
    setPreviewFrame(clamped);
    setPreviewTick((tick) => tick + 1);
  }, [previewBounds.endFrame, previewBounds.startFrame, sourceVideoRef, video.fps, video.frameCount]);

  useEffect(() => {
    const element = sourceVideoRef.current;
    if (!element) return;
    setPreviewReady(false);
    const initialize = () => {
      element.pause();
      element.currentTime = frameToCenterSeconds(pin.frame, video.fps);
      setPreviewReady(true);
      setPreviewFrame(pin.frame);
      setPreviewTick((tick) => tick + 1);
    };
    element.addEventListener('seeked', syncPreviewFrame);
    element.addEventListener('timeupdate', syncPreviewFrame);
    if (element.readyState >= HTMLMediaElement.HAVE_METADATA) initialize();
    else element.addEventListener('loadedmetadata', initialize, { once: true });
    return () => {
      element.removeEventListener('loadedmetadata', initialize);
      element.removeEventListener('seeked', syncPreviewFrame);
      element.removeEventListener('timeupdate', syncPreviewFrame);
    };
  }, [pin.frame, sourceVideoRef, syncPreviewFrame, video.fps]);

  const stopPreview = useCallback(() => {
    previewDirectionRef.current = 0;
    previewLastTsRef.current = null;
    if (previewRafRef.current != null) cancelAnimationFrame(previewRafRef.current);
    previewRafRef.current = null;
    sourceVideoRef.current?.pause();
    syncPreviewFrame();
  }, [sourceVideoRef, syncPreviewFrame]);

  const returnToPin = useCallback(() => {
    stopPreview();
    const element = sourceVideoRef.current;
    if (element) element.currentTime = frameToCenterSeconds(pin.frame, video.fps);
    setPreviewFrame(pin.frame);
    setPreviewTick((tick) => tick + 1);
  }, [pin.frame, sourceVideoRef, stopPreview, video.fps]);

  const startPreview = useCallback((direction: -1 | 1) => {
    const element = sourceVideoRef.current;
    if (!element || !previewReady || previewDirectionRef.current === direction) return;
    stopPreview();
    previewDirectionRef.current = direction;
    if (direction === 1) {
      void element.play().catch(() => undefined);
      const tick = (timestamp: number) => {
        if (previewDirectionRef.current !== 1) return;
        const previous = previewLastTsRef.current ?? timestamp;
        previewLastTsRef.current = timestamp;
        if (element.paused) {
          element.currentTime = Math.min(
            frameToCenterSeconds(videoFrame(previewBounds.endFrame), video.fps),
            element.currentTime + Math.max(0, timestamp - previous) / 1000,
          );
        }
        syncPreviewFrame();
        if (element.currentTime >= frameToCenterSeconds(videoFrame(previewBounds.endFrame), video.fps)) {
          element.currentTime = frameToCenterSeconds(videoFrame(previewBounds.endFrame), video.fps);
          stopPreview();
          return;
        }
        previewRafRef.current = requestAnimationFrame(tick);
      };
      previewRafRef.current = requestAnimationFrame(tick);
      return;
    }
    const tick = (timestamp: number) => {
      if (previewDirectionRef.current !== -1) return;
      const previous = previewLastTsRef.current ?? timestamp;
      previewLastTsRef.current = timestamp;
      element.currentTime = Math.max(
        frameToCenterSeconds(videoFrame(previewBounds.startFrame), video.fps),
        element.currentTime - Math.max(0, timestamp - previous) / 1000,
      );
      syncPreviewFrame();
      if (element.currentTime <= frameToCenterSeconds(videoFrame(previewBounds.startFrame), video.fps)) {
        stopPreview();
        return;
      }
      previewRafRef.current = requestAnimationFrame(tick);
    };
    previewRafRef.current = requestAnimationFrame(tick);
  }, [previewBounds.endFrame, previewBounds.startFrame, previewReady, sourceVideoRef, stopPreview, syncPreviewFrame, video.fps]);

  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (
        event.code === 'Space'
        || event.key === ' '
        || event.key === 'Space'
        || event.key === 'Spacebar'
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        returnToPin();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopImmediatePropagation();
        startPreview(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopImmediatePropagation();
        startPreview(1);
      }
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopImmediatePropagation();
        stopPreview();
      }
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      stopPreview();
    };
  }, [returnToPin, startPreview, stopPreview]);

  const autoCalibrate = useCallback(async () => {
    if (!videoRef || video.frameCount < 2) return;
    const paddingFrames = Math.max(1, Math.round(video.fps * 0.4));
    const range = {
      startFrame: videoFrame(Math.max(0, pin.frame - paddingFrames)),
      endFrame: frameBoundary(Math.min(video.frameCount, pin.frame + paddingFrames + 1)),
    };
    setCalibrating(true);
    setMessage(null);
    try {
      const result = await requestHomography({
        videoRef,
        startMs: Number(frameToMs(range.startFrame, video.fps)),
        endMs: Number(sidecarSampleEndMs(range, video.fps)),
        fps: 5,
      });
      const matrix = resolveUsableHomographyAtTime(
        result.frames,
        Number(frameToMs(pin.frame, video.fps)),
      );
      const quad = projectPitchBoundsToPerspectiveQuad(matrix);
      if (!quad) throw new Error(t('pin.autoCalibrateFailed'));
      setAutoPerspectiveQuad(quad);
      setAutoPerspectiveTick((tick) => tick + 1);
      setTool('select');
      setMessage(t('pin.autoCalibrateApplied'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCalibrating(false);
    }
  }, [pin.frame, t, video.fps, video.frameCount, videoRef]);

  if (!selectedReference) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
        <div className="border border-border bg-surface p-5 text-sm">
          {t('pin.noSet')}
          <div className="mt-3 flex gap-2">
            <button onClick={() => void createSet()}>{t('pin.createDefault')}</button>
            <button onClick={onClose}>{t('pin.closeShort')}</button>
          </div>
          {message && <p className="text-muted">{message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-black" data-testid="pin-annotator">
      <header className="workspace-bar text-sm">
        <button className="button-quiet border-r border-border px-4" onClick={onClose}>{t('pin.close')}</button>
        <button
          className="button-primary border-y-0 border-l-0 px-4"
          disabled={!editorReady}
          onClick={() => setSaveTick((tick) => tick + 1)}
        >
          {t('common.save')}
        </button>
        <div className="flex items-center px-3 text-muted">
          {saveStatus.state === 'saving' ? t('clip.saving') : saveStatus.state === 'saved' ? t('clip.saved') : saveStatus.state === 'error' ? t('clip.saveFailed') : ''}
        </div>
        <label className="flex items-center gap-2 border-l border-border px-3">
          {t('pin.set')}
          <select value={selectedReference.id} onChange={(event) => setSelectedAnnotationId(event.target.value)}>
            {activePin.annotations.map((reference) => (
              <option key={reference.id} value={reference.id}>{reference.label || (reference.role === 'default' ? t('pin.defaultAnnotations') : reference.id)}</option>
            ))}
          </select>
        </label>
        {!creatingSet ? (
          <button className="border-0 border-l border-solid border-border px-3" onClick={() => setCreatingSet(true)}>{t('pin.newSet')}</button>
        ) : (
          <div className="flex items-center gap-1 border-l border-border px-2">
            <input value={newSetLabel} onChange={(event) => setNewSetLabel(event.target.value)} placeholder={t('pin.setLabel')} />
            <button onClick={() => void createSet()}>{t('common.create')}</button>
            <button onClick={() => setCreatingSet(false)}>{t('common.cancel')}</button>
          </div>
        )}
        <button className="border-0 border-l border-solid border-border px-3" disabled={activePin.annotations.length <= 1} onClick={() => void deleteSet()}>{t('pin.deleteSet')}</button>
        {deletedAnnotation && <button className="border-0 border-l border-solid border-border px-3" onClick={() => void undoDeleteSet()}>{t('pin.undoSetDelete')}</button>}
        <span className="flex-1" />
        <button className="border-0 border-l border-solid border-border px-3" disabled={!editorReady} onClick={requestImport}>{t('pin.importClip')}</button>
        <div className="flex items-center border-l border-border px-3 text-muted">{t('pin.atFrame', { frame: formatNumber(pin.frame) })}</div>
      </header>

      <AnnotateToolbar
        tool={tool}
        onToolChange={setTool}
        strokePattern={strokePattern}
        onStrokePatternChange={setStrokePattern}
        strokeColor={strokeColor}
        onStrokeColorChange={setStrokeColor}
        fillColor={fillColor}
        onFillColorChange={setFillColor}
        colorsLinked={colorsLinked}
        onColorsLinkedChange={setColorsLinked}
        strokeWidth={strokeWidth}
        onStrokeWidthChange={setStrokeWidth}
        fillOpacity={fillOpacity}
        onFillOpacityChange={setFillOpacity}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        textHighlight={textHighlight}
        onTextHighlightChange={setTextHighlight}
        disabled={annotationsLocked}
        canAutoCalibrate={!!videoRef && video.frameCount > 1}
        isAutoCalibrating={calibrating}
        onAutoCalibrate={() => void autoCalibrate()}
        hasHomography={hasHomography}
        showHomography={showHomography}
        onShowHomographyChange={setShowHomography}
        onDeleteHomography={() => {
          setShowHomography(false);
          setClearPerspectiveTick((tick) => tick + 1);
          setMessage(t('pin.homographyDeleted'));
        }}
      />
      <div className="flex shrink-0 items-center border-b border-border bg-surface px-3 py-1 text-xs text-muted">
        {previewReady
          ? annotationsLocked
            ? t('pin.lockedPreview', { frame: formatNumber(previewFrame) })
            : t('pin.editable')
          : null}
        {annotationsLocked && (
          <button className="button-quiet ml-3 px-2 py-0.5" onClick={returnToPin}>
            {t('pin.returnToFrame')}
          </button>
        )}
        {message && <span className="ml-auto text-secondary" role="status">{message}</span>}
      </div>
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-black touch-none"
        onWheel={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const next = Math.max(0.05, Math.min(8, stageScale * Math.exp(-event.deltaY * 0.001)));
          const localX = event.clientX - rect.left;
          const localY = event.clientY - rect.top;
          const imageX = (localX - stageOffset.x) / stageScale;
          const imageY = (localY - stageOffset.y) / stageScale;
          setStageScale(next);
          setStageOffset({ x: localX - imageX * next, y: localY - imageY * next });
        }}
        onPointerDown={(event) => {
          if (event.button !== 1) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offset: stageOffset };
        }}
        onPointerMove={(event) => {
          const pan = panRef.current;
          if (!pan || pan.pointerId !== event.pointerId) return;
          setStageOffset({ x: pan.offset.x + event.clientX - pan.x, y: pan.offset.y + event.clientY - pan.y });
        }}
        onPointerUp={(event) => {
          if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
        }}
      >
        <Editor
          key={`${activeClip.id}:${activePin.id}:${selectedReference.id}`}
          anchor={{ kind: 'pin', clipId: activeClip.id, pinId: activePin.id, frame: activePin.frame }}
          annotationId={selectedReference.id}
          annotationFilePath={pinAnnotationPath(activeClip.id, selectedReference.id).join('/')}
          annotationLabel={selectedReference.label}
          imageInfo={{ file: `${video.file}#frame=${pin.frame}`, width: video.width, height: video.height }}
          imgUrl={null}
          stageScale={stageScale}
          stageOffset={stageOffset}
          tool={tool}
          defaultStrokePattern={strokePattern}
          defaultColor={strokeColor}
          defaultStrokeWidth={strokeWidth}
          defaultFill={fillColor}
          defaultFillOpacity={fillOpacity}
          defaultFontSize={fontSize}
          defaultTextHighlight={textHighlight}
          onRequestToolChange={setTool}
          saveTick={saveTick}
          onSaveStatus={setSaveStatus}
          onReady={handleEditorReady}
          autoPerspectiveQuad={autoPerspectiveQuad}
          autoPerspectiveTick={autoPerspectiveTick}
          clearPerspectiveTick={clearPerspectiveTick}
          showHomography={showHomography}
          onHomographyAvailabilityChange={setHasHomography}
          backgroundVideoElement={sourceVideoRef.current}
          backgroundFrameTick={previewTick}
          annotationsLocked={annotationsLocked}
          projectDir={projectDir}
          persistDocument={persistDocument}
        />
      </div>
    </div>
  );
}
