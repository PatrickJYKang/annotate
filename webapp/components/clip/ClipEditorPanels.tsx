"use client";

import { useEffect, useState, type ReactNode } from 'react';
import {
  Panel,
  PanelResizeHandle,
  Panels,
} from '../panels/Panels';
import type {
  ClipAnnotation,
  ClipPin,
} from '../../lib/types/clip';
import { useLocale } from '../../lib/i18n';

export function ClipEditorShell({
  viewer,
  inspector,
  timeline,
}: {
  viewer: ReactNode;
  inspector: ReactNode;
  timeline: ReactNode;
}) {
  return (
    <Panels
      autoSaveId="annotate:clip:viewer-timeline"
      direction="vertical"
      className="flex-1"
      data-testid="clip-panel-group-vertical"
    >
      <Panel id="clip-workspace" defaultSize={72} minSize={38}>
        <Panels
          autoSaveId="annotate:clip:viewer-inspector"
          direction="horizontal"
          data-testid="clip-panel-group-horizontal"
        >
          <Panel id="clip-viewer" defaultSize={78} minSize={45}>
            <ViewerPanel>{viewer}</ViewerPanel>
          </Panel>
          <PanelResizeHandle direction="horizontal" data-testid="clip-inspector-resize-handle" />
          <Panel id="clip-inspector" defaultSize={22} minSize={16} maxSize={42}>
            <InspectorPanel>{inspector}</InspectorPanel>
          </Panel>
        </Panels>
      </Panel>
      <PanelResizeHandle direction="vertical" data-testid="clip-timeline-resize-handle" />
      <Panel id="clip-timeline-panel" defaultSize={28} minSize={14} maxSize={58}>
        <TimelinePanel>{timeline}</TimelinePanel>
      </Panel>
    </Panels>
  );
}

export function ViewerPanel({ children }: { children: ReactNode }) {
  return <main className="flex h-full min-h-0 min-w-0 flex-col bg-black">{children}</main>;
}

export function TimelinePanel({ children }: { children: ReactNode }) {
  return <div className="h-full min-h-0 overflow-hidden bg-surface">{children}</div>;
}

export function InspectorPanel({ children }: { children: ReactNode }) {
  return <aside className="h-full overflow-y-auto border-l border-border bg-surface p-3 text-xs">{children}</aside>;
}

export function PinList({
  currentFrame,
  hasPinAtCurrentFrame,
  selectedPin,
  pinLabelDraft,
  canCreate,
  hasDeletedPin,
  onOpenCurrent,
  onPinLabelChange,
  onSaveLabel,
  onGoToPin,
  onDelete,
  onUndoDelete,
}: {
  currentFrame: number;
  hasPinAtCurrentFrame: boolean;
  selectedPin: ClipPin | null;
  pinLabelDraft: string;
  canCreate: boolean;
  hasDeletedPin: boolean;
  onOpenCurrent: () => void | Promise<void>;
  onPinLabelChange: (label: string) => void;
  onSaveLabel: () => void | Promise<void>;
  onGoToPin: (frame: number) => void;
  onDelete: () => void | Promise<void>;
  onUndoDelete: () => void | Promise<void>;
}) {
  const { t, formatNumber } = useLocale();
  return (
    <section>
      <h2 className="section-kicker mb-2">{t('clip.pins')}</h2>
      <div className="space-y-2">
        <button className="button-primary w-full" onClick={() => void onOpenCurrent()} disabled={!canCreate}>
          {hasPinAtCurrentFrame
            ? t('clip.openPin', { frame: formatNumber(currentFrame) })
            : t('clip.addPin', { frame: formatNumber(currentFrame) })}
        </button>
        {selectedPin && (
          <div className="property-section">
            <div className="property-row">
              <strong>{t('clip.frame', { frame: formatNumber(selectedPin.frame) })}</strong>
              <span>
              {selectedPin.annotations.length === 1
                ? t('clip.annotationSetCountOne')
                : t('clip.annotationSetCountMany', { count: formatNumber(selectedPin.annotations.length) })}
              </span>
            </div>
            <input
              aria-label={t('clip.pinLabel')}
              className="mb-1 w-full"
              value={pinLabelDraft}
              onChange={(event) => onPinLabelChange(event.target.value)}
              placeholder={t('clip.pinLabel')}
            />
            <div className="grid grid-cols-2 gap-1">
              <button onClick={() => void onSaveLabel()}>{t('clip.saveLabel')}</button>
              <button onClick={() => onGoToPin(selectedPin.frame)}>{t('clip.goToPin')}</button>
            </div>
            <button className="button-danger mt-1 w-full" onClick={() => void onDelete()}>{t('clip.deletePin')}</button>
          </div>
        )}
        {hasDeletedPin && <button className="w-full" onClick={() => void onUndoDelete()}>{t('clip.undoPinDelete')}</button>}
      </div>
    </section>
  );
}

export function TrackingToolbar({
  phase,
  hasCandidate,
  hasStarted,
  detecting,
  canTrack,
  onBegin,
  onStart,
  onStop,
}: {
  phase: 'idle' | 'choosing' | 'running';
  hasCandidate: boolean;
  hasStarted: boolean;
  detecting: boolean;
  canTrack: boolean;
  onBegin: () => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="mb-2 grid grid-cols-2 gap-1">
      {phase === 'idle' ? (
        <button className="button-primary col-span-2 w-full" onClick={onBegin} disabled={!canTrack}>
          {t('clip.track')}
        </button>
      ) : phase === 'running' ? (
        <button className="button-danger col-span-2 w-full" onClick={onStop}>
          {t('clip.stop')}
        </button>
      ) : (
        <>
          <button className="button-primary w-full" onClick={onStart} disabled={!hasCandidate}>
            {detecting && !hasCandidate
              ? t('clip.detecting')
              : t(hasStarted ? 'clip.continue' : 'clip.start')}
          </button>
          <button className="button-danger w-full" onClick={onStop}>{t('clip.stop')}</button>
        </>
      )}
    </div>
  );
}

export function AnnotationInspector({
  annotation,
  trackingState,
  hasPositionKeyframe,
  hasVisibilityKeyframe,
  trackingPhase,
  trackingHasCandidate,
  trackingHasStarted,
  detectingPlayers,
  canTrack,
  onAddKeyframe,
  onDeleteKeyframe,
  onBeginTracking,
  onStartTracking,
  onStopTracking,
  onRenameHighlight,
  onDisplayHighlightName,
  onHighlightNameFontSize,
  defaultFontSize,
  selectedObjectCount,
  canMergeObjects,
  onMergeObjects,
  onDeleteObject,
}: {
  annotation: ClipAnnotation | null;
  trackingState: string | null;
  hasPositionKeyframe: boolean;
  hasVisibilityKeyframe: boolean;
  trackingPhase: 'idle' | 'choosing' | 'running';
  trackingHasCandidate: boolean;
  trackingHasStarted: boolean;
  detectingPlayers: boolean;
  canTrack: boolean;
  onAddKeyframe: () => void;
  onDeleteKeyframe: () => void;
  onBeginTracking: () => void;
  onStartTracking: () => void;
  onStopTracking: () => void;
  onRenameHighlight: (name?: string) => void;
  onDisplayHighlightName: (displayName: boolean) => void;
  onHighlightNameFontSize: (fontSize: number) => void;
  defaultFontSize: number;
  selectedObjectCount: number;
  canMergeObjects: boolean;
  onMergeObjects: () => void;
  onDeleteObject: () => void;
}) {
  const { t, formatNumber } = useLocale();
  const [nameDraft, setNameDraft] = useState('');

  useEffect(() => {
    setNameDraft(annotation?.type === 'highlight' ? annotation.name ?? '' : '');
  }, [annotation?.id, annotation?.name, annotation?.type]);

  const commitHighlightName = () => {
    if (annotation?.type !== 'highlight') return;
    const name = nameDraft.trim();
    setNameDraft(name);
    if (name !== (annotation.name ?? '')) onRenameHighlight(name || undefined);
  };

  return (
    <section>
      <h2 className="section-kicker mb-2">{t('clip.objectInspector')}</h2>
      <TrackingToolbar
        phase={trackingPhase}
        hasCandidate={trackingHasCandidate}
        hasStarted={trackingHasStarted}
        detecting={detectingPlayers}
        canTrack={canTrack}
        onBegin={onBeginTracking}
        onStart={onStartTracking}
        onStop={onStopTracking}
      />
      {annotation ? (
        <div className="space-y-2">
          <div className="property-section">
            {annotation.type === 'highlight' && (
              <>
                <label className="block px-2 py-1.5 text-muted">
                  <span className="mb-1 block">{t('annotation.name')}</span>
                  <input
                    aria-label={t('annotation.name')}
                    className="w-full"
                    type="text"
                    maxLength={80}
                    value={nameDraft}
                    placeholder={t('annotation.name')}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onBlur={commitHighlightName}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                </label>
                <label
                  className="inline-flex w-fit items-center gap-2 px-2 py-1.5 text-muted"
                  htmlFor={`clip-highlight-display-name-${annotation.id}`}
                >
                  <span>{t('annotation.displayName')}</span>
                  <input
                    id={`clip-highlight-display-name-${annotation.id}`}
                    aria-label={t('annotation.displayName')}
                    type="checkbox"
                    checked={!!annotation.displayName}
                    onChange={(event) => onDisplayHighlightName(event.target.checked)}
                  />
                </label>
                {annotation.displayName && (
                  <label className="block px-2 py-1.5 text-muted">
                    <span className="mb-1 block">{t('annotation.textSize')}</span>
                    <input
                      aria-label={t('annotation.textSize')}
                      className="w-full"
                      type="number"
                      min={8}
                      max={300}
                      step={1}
                      value={annotation.style.fontSize || defaultFontSize}
                      onChange={(event) => onHighlightNameFontSize(Number(event.target.value) || defaultFontSize)}
                    />
                  </label>
                )}
              </>
            )}
            <div className="property-row">
              <strong className="capitalize text-primary">{t(`tool.${annotation.type}`)}</strong>
              <span>{t('clip.source', {
              coords: t(`clip.coord${annotation.coordMode === 'pitch' ? 'Pitch' : 'Image'}`),
              source: t(`clip.source.${annotation.source}`),
              })}</span>
            </div>
            <div className="property-row">
              <span>
              {annotation.keyframes.length === 1
                ? t('clip.keyframeCountOne')
                : t('clip.keyframeCountMany', { count: formatNumber(annotation.keyframes.length) })}
              </span>
            </div>
            <div className="property-row">
              <span>{t('clip.currentSpan', {
                state: trackingState ? t(`clip.showState.${trackingState}`) : '',
              })}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button onClick={onAddKeyframe} disabled={hasPositionKeyframe}>{t('clip.keyframeHere')}</button>
            <button onClick={onDeleteKeyframe} disabled={!hasPositionKeyframe && !hasVisibilityKeyframe}>{t('clip.deleteKeyframe')}</button>
          </div>
          {selectedObjectCount >= 2 && (
            <button
              className="button-primary w-full"
              data-testid="clip-merge-objects"
              disabled={!canMergeObjects}
              onClick={onMergeObjects}
            >
              {t('clip.mergeObjects')}
            </button>
          )}
          <button className="button-danger w-full" onClick={onDeleteObject}>{t('clip.deleteObject')}</button>
        </div>
      ) : (
        <div className="empty-state h-20" aria-hidden="true" />
      )}
    </section>
  );
}
