"use client";

import type { ReactNode } from 'react';
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
  onAnnotate,
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
  onAnnotate: (pinId: string) => void | Promise<void>;
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
              <button onClick={() => void onAnnotate(selectedPin.id)}>{t('clip.annotate')}</button>
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
  tracking,
  canTrack,
  nextCorrectionFrame,
  rangeEndFrame,
  currentFrame,
  onTrack,
}: {
  tracking: boolean;
  canTrack: boolean;
  nextCorrectionFrame: number | null;
  rangeEndFrame: number | null;
  currentFrame: number;
  onTrack: (mode?: 'correction' | 'range') => void | Promise<void>;
}) {
  const { t, formatNumber } = useLocale();
  return (
    <div className="space-y-2">
      <button className="w-full" onClick={() => void onTrack()} disabled={tracking || !canTrack}>
        {tracking ? t('clip.tracking') : t('clip.trackEnd')}
      </button>
      {nextCorrectionFrame !== null && (
        <button className="w-full" onClick={() => void onTrack('correction')} disabled={tracking || !canTrack}>
          {t('clip.trackCorrection', { frame: formatNumber(nextCorrectionFrame) })}
        </button>
      )}
      {rangeEndFrame !== null && (
        <button
          className="w-full"
          onClick={() => void onTrack('range')}
          disabled={tracking || !canTrack || rangeEndFrame === currentFrame}
        >
          {t('clip.retrackRange', { frame: formatNumber(rangeEndFrame) })}
        </button>
      )}
    </div>
  );
}

export function AnnotationInspector({
  annotation,
  trackingState,
  hasPositionKeyframe,
  hasVisibilityKeyframe,
  nextCorrectionFrame,
  rangeEndFrame,
  currentFrame,
  tracking,
  canTrack,
  onAddKeyframe,
  onDeleteKeyframe,
  onShow,
  onHide,
  onTrack,
  onDeleteObject,
}: {
  annotation: ClipAnnotation | null;
  trackingState: string | null;
  hasPositionKeyframe: boolean;
  hasVisibilityKeyframe: boolean;
  nextCorrectionFrame: number | null;
  rangeEndFrame: number | null;
  currentFrame: number;
  tracking: boolean;
  canTrack: boolean;
  onAddKeyframe: () => void;
  onDeleteKeyframe: () => void;
  onShow: () => void;
  onHide: () => void;
  onTrack: (mode?: 'correction' | 'range') => void | Promise<void>;
  onDeleteObject: () => void;
}) {
  const { t, formatNumber } = useLocale();
  return (
    <section>
      <h2 className="section-kicker mb-2">{t('clip.objectInspector')}</h2>
      {annotation ? (
        <div className="space-y-2">
          <div className="property-section">
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
            <button onClick={onShow}>{t('clip.showKeyframe')}</button>
            <button onClick={onHide}>{t('clip.hideKeyframe')}</button>
          </div>
          <TrackingToolbar
            tracking={tracking}
            canTrack={canTrack && annotation.type === 'highlight'}
            nextCorrectionFrame={nextCorrectionFrame}
            rangeEndFrame={rangeEndFrame}
            currentFrame={currentFrame}
            onTrack={onTrack}
          />
          <button className="button-danger w-full" onClick={onDeleteObject}>{t('clip.deleteObject')}</button>
        </div>
      ) : (
        <div className="empty-state h-20" aria-hidden="true" />
      )}
    </section>
  );
}
