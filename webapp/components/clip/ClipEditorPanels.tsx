"use client";

import { useEffect, useState, type ReactNode } from 'react';
import {
  Panel,
  PanelResizeHandle,
  Panels,
} from '../panels/Panels';
import ColorLinkToggle from '../annotate/ColorLinkToggle';
import type {
  ClipAnnotation,
  ClipAnnotationStyle,
  ClipPin,
  StrokePattern,
} from '../../lib/types/clip';
import { useLocale } from '../../lib/i18n';

function isFillCapable(annotation: ClipAnnotation): boolean {
  return annotation.type === 'box'
    || annotation.type === 'circle'
    || annotation.type === 'highlight'
    || annotation.type === 'shadow'
    || (annotation.type === 'poly' && !!annotation.closed);
}

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
  disabled = false,
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
  disabled?: boolean;
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
        <button className="button-primary w-full" onClick={() => void onOpenCurrent()} disabled={!canCreate || disabled}>
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
              disabled={disabled}
              onChange={(event) => onPinLabelChange(event.target.value)}
              placeholder={t('clip.pinLabel')}
            />
            <div className="grid grid-cols-2 gap-1">
              <button disabled={disabled} onClick={() => void onSaveLabel()}>{t('clip.saveLabel')}</button>
              <button onClick={() => onGoToPin(selectedPin.frame)}>{t('clip.goToPin')}</button>
            </div>
            <button disabled={disabled} className="button-danger mt-1 w-full" onClick={() => void onDelete()}>{t('clip.deletePin')}</button>
          </div>
        )}
        {hasDeletedPin && <button disabled={disabled} className="w-full" onClick={() => void onUndoDelete()}>{t('clip.undoPinDelete')}</button>}
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
  canRetrack,
  retrackActive,
  onBegin,
  onStart,
  onStop,
  onBeginRetrack,
  onFinishRetrack,
  onCancelRetrack,
}: {
  phase: 'idle' | 'choosing' | 'running';
  hasCandidate: boolean;
  hasStarted: boolean;
  detecting: boolean;
  canTrack: boolean;
  canRetrack: boolean;
  retrackActive: boolean;
  onBegin: () => void;
  onStart: () => void;
  onStop: () => void;
  onBeginRetrack: () => void;
  onFinishRetrack: () => void;
  onCancelRetrack: () => void;
}) {
  const { t } = useLocale();
  if (retrackActive) {
    return (
      <div className="mb-2 grid grid-cols-2 gap-1" data-testid="clip-retrack-controls">
        {phase === 'running' ? (
          <button className="button-danger w-full" onClick={onStop}>{t('clip.stop')}</button>
        ) : phase === 'choosing' ? (
          <button className="button-primary w-full" onClick={onStart} disabled={!hasCandidate}>
            {detecting && !hasCandidate ? t('clip.detecting') : t('clip.continue')}
          </button>
        ) : (
          <button className="button-primary w-full" onClick={onFinishRetrack}>{t('clip.done')}</button>
        )}
        <button className="w-full" onClick={onCancelRetrack}>{t('common.cancel')}</button>
        {phase === 'choosing' && (
          <button className="button-primary col-span-2 w-full" onClick={onFinishRetrack}>
            {t('clip.done')}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mb-2 grid grid-cols-2 gap-1">
      {phase === 'idle' ? (
        <>
          <button className={`button-primary w-full ${canRetrack ? '' : 'col-span-2'}`} onClick={onBegin} disabled={!canTrack}>
            {t('clip.track')}
          </button>
          {canRetrack && (
            <button data-testid="clip-retrack-begin" className="w-full" onClick={onBeginRetrack}>
              {t('clip.retrackFromHere')}
            </button>
          )}
        </>
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
  selectedAnnotations,
  trackingState,
  hasPositionKeyframe,
  hasVisibilityKeyframe,
  trackingPhase,
  trackingHasCandidate,
  trackingHasStarted,
  detectingPlayers,
  canTrack,
  canRetrack,
  retrackActive,
  editingLocked,
  onAddKeyframe,
  onDeleteKeyframe,
  onBeginTracking,
  onStartTracking,
  onStopTracking,
  onBeginRetracking,
  onFinishRetracking,
  onCancelRetracking,
  onRenameHighlight,
  onDisplayHighlightName,
  onHighlightNameFontSize,
  onUpdateSelectedStyles,
  shadowRadius,
  shadowSpread,
  onUpdateShadowGeometry,
  defaultFontSize,
  selectedObjectCount,
  canMergeObjects,
  onMergeObjects,
  onDeleteObject,
}: {
  annotation: ClipAnnotation | null;
  selectedAnnotations: ClipAnnotation[];
  trackingState: string | null;
  hasPositionKeyframe: boolean;
  hasVisibilityKeyframe: boolean;
  trackingPhase: 'idle' | 'choosing' | 'running';
  trackingHasCandidate: boolean;
  trackingHasStarted: boolean;
  detectingPlayers: boolean;
  canTrack: boolean;
  canRetrack: boolean;
  retrackActive: boolean;
  editingLocked: boolean;
  onAddKeyframe: () => void;
  onDeleteKeyframe: () => void;
  onBeginTracking: () => void;
  onStartTracking: () => void;
  onStopTracking: () => void;
  onBeginRetracking: () => void;
  onFinishRetracking: () => void;
  onCancelRetracking: () => void;
  onRenameHighlight: (name?: string) => void;
  onDisplayHighlightName: (displayName: boolean) => void;
  onHighlightNameFontSize: (fontSize: number) => void;
  onUpdateSelectedStyles: (
    updateStyle: (annotation: ClipAnnotation) => ClipAnnotationStyle,
  ) => void;
  shadowRadius: number | null;
  shadowSpread: number | null;
  onUpdateShadowGeometry: (patch: { r?: number; spreadDeg?: number }) => void;
  defaultFontSize: number;
  selectedObjectCount: number;
  canMergeObjects: boolean;
  onMergeObjects: () => void;
  onDeleteObject: () => void;
}) {
  const { t, formatNumber } = useLocale();
  const [nameDraft, setNameDraft] = useState('');
  const [colorsLinked, setColorsLinked] = useState(true);

  useEffect(() => {
    setNameDraft(annotation?.type === 'highlight' ? annotation.name ?? '' : '');
  }, [annotation?.id, annotation?.name, annotation?.type]);

  const first = selectedAnnotations[0] ?? annotation;
  const fillSample = selectedAnnotations.find(isFillCapable);
  const textSample = selectedAnnotations.find((candidate) => candidate.type === 'text');
  const strokeColor = first?.style.stroke ?? '#ffffff';
  const fillColor = fillSample?.style.fill && fillSample.style.fill !== 'transparent'
    ? fillSample.style.fill
    : fillSample?.style.stroke ?? strokeColor;
  const patterns = new Set(
    selectedAnnotations
      .filter((candidate) => candidate.type !== 'text')
      .map((candidate) => candidate.style.strokePattern ?? 'solid'),
  );
  const strokePattern: StrokePattern = patterns.size === 1
    ? [...patterns][0]
    : 'solid';

  const commitHighlightName = () => {
    if (annotation?.type !== 'highlight') return;
    const name = nameDraft.trim();
    setNameDraft(name);
    if (name !== (annotation.name ?? '')) onRenameHighlight(name || undefined);
  };

  const updateStrokeColor = (stroke: string) => {
    onUpdateSelectedStyles((candidate) => ({
      ...candidate.style,
      stroke,
      ...(colorsLinked && isFillCapable(candidate) ? { fill: stroke } : {}),
    }));
  };

  const updateFillColor = (fill: string) => {
    onUpdateSelectedStyles((candidate) => {
      if (colorsLinked) {
        return {
          ...candidate.style,
          stroke: fill,
          ...(isFillCapable(candidate) ? { fill } : {}),
        };
      }
      return isFillCapable(candidate)
        ? { ...candidate.style, fill }
        : candidate.style;
    });
  };

  const toggleColorsLinked = () => {
    const linked = !colorsLinked;
    setColorsLinked(linked);
    if (!linked) return;
    onUpdateSelectedStyles((candidate) => (
      isFillCapable(candidate)
        ? { ...candidate.style, fill: strokeColor }
        : candidate.style
    ));
  };

  return (
    <section>
      <h2 className="section-kicker mb-2">{t('clip.objectInspector')}</h2>
      <TrackingToolbar
        phase={trackingPhase}
        hasCandidate={trackingHasCandidate}
        hasStarted={trackingHasStarted}
        detecting={detectingPlayers}
        canTrack={canTrack && !editingLocked}
        canRetrack={canRetrack}
        retrackActive={retrackActive}
        onBegin={onBeginTracking}
        onStart={onStartTracking}
        onStop={onStopTracking}
        onBeginRetrack={onBeginRetracking}
        onFinishRetrack={onFinishRetracking}
        onCancelRetrack={onCancelRetracking}
      />
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={editingLocked}>
      {annotation ? (
        <div className="space-y-2">
          <div className="property-section">
            {selectedObjectCount === 1 && annotation.type === 'highlight' && (
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
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] items-center gap-x-2 gap-y-1.5 px-2 py-1.5">
              {fillSample ? (
                <>
                  <span className="text-muted">{t('annotation.colors')}</span>
                  <div className="flex min-w-0 items-center gap-1">
                    <input
                      data-testid="clip-inspector-stroke-color"
                      aria-label={t('annotation.strokeColor')}
                      type="color"
                      value={strokeColor}
                      onChange={(event) => updateStrokeColor(event.target.value)}
                    />
                    <ColorLinkToggle linked={colorsLinked} onToggle={toggleColorsLinked} />
                    <input
                      data-testid="clip-inspector-fill-color"
                      aria-label={t('annotation.fillColor')}
                      type="color"
                      value={fillColor}
                      onChange={(event) => updateFillColor(event.target.value)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <label className="text-muted" htmlFor="clip-inspector-stroke-color">
                    {t('annotation.stroke')}
                  </label>
                  <input
                    id="clip-inspector-stroke-color"
                    data-testid="clip-inspector-stroke-color"
                    aria-label={t('annotation.strokeColor')}
                    type="color"
                    value={strokeColor}
                    onChange={(event) => updateStrokeColor(event.target.value)}
                  />
                </>
              )}

              <label className="text-muted" htmlFor="clip-inspector-stroke-width">
                {t('annotation.width')}
              </label>
              <input
                id="clip-inspector-stroke-width"
                data-testid="clip-inspector-stroke-width"
                aria-label={t('annotation.width')}
                className="clip-stroke-width-input w-full"
                style={{ width: '100%' }}
                type="number"
                min={1}
                max={16}
                step={1}
                value={first?.style.strokeWidth ?? 4}
                onChange={(event) => {
                  const strokeWidth = Math.max(1, Math.min(16, Number(event.target.value) || 1));
                  onUpdateSelectedStyles((candidate) => ({ ...candidate.style, strokeWidth }));
                }}
              />

              <label className="text-muted" htmlFor="clip-inspector-stroke-pattern">
                {t('annotation.style')}
              </label>
              <select
                id="clip-inspector-stroke-pattern"
                data-testid="clip-inspector-stroke-pattern"
                value={strokePattern}
                onChange={(event) => {
                  const nextPattern = (event.target.value || 'solid') as StrokePattern;
                  onUpdateSelectedStyles((candidate) => (
                    candidate.type === 'text'
                      ? candidate.style
                      : { ...candidate.style, strokePattern: nextPattern }
                  ));
                }}
              >
                <option value="solid">{t('annotation.patternSolid')}</option>
                <option value="dashed">{t('annotation.patternDashed')}</option>
                <option value="dotted">{t('annotation.patternDotted')}</option>
                <option value="dashdot">{t('annotation.patternDashdot')}</option>
              </select>

              {fillSample && (
                <>
                  <label className="text-muted" htmlFor="clip-inspector-fill-opacity">
                    {t('annotation.fillOpacity')}
                  </label>
                  <input
                    id="clip-inspector-fill-opacity"
                    data-testid="clip-inspector-fill-opacity"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round((fillSample.style.fillOpacity ?? 0.3) * 100)}
                    onChange={(event) => {
                      const fillOpacity = Math.max(0, Math.min(100, Number(event.target.value) || 0)) / 100;
                      onUpdateSelectedStyles((candidate) => (
                        isFillCapable(candidate)
                          ? { ...candidate.style, fillOpacity }
                          : candidate.style
                      ));
                    }}
                  />
                </>
              )}

              {textSample && (
                <>
                  <label className="text-muted" htmlFor="clip-inspector-font-size">
                    {t('annotation.font')}
                  </label>
                  <input
                    id="clip-inspector-font-size"
                    data-testid="clip-inspector-font-size"
                    aria-label={t('annotation.font')}
                    className="clip-stroke-width-input w-full"
                    style={{ width: '100%' }}
                    type="number"
                    min={1}
                    max={300}
                    step={1}
                    value={textSample.style.fontSize ?? 48}
                    onChange={(event) => {
                      const fontSize = Math.max(1, Math.min(300, Number(event.target.value) || 48));
                      onUpdateSelectedStyles((candidate) => (
                        candidate.type === 'text'
                          ? { ...candidate.style, fontSize }
                          : candidate.style
                      ));
                    }}
                  />

                  <label className="text-muted" htmlFor="clip-inspector-text-highlight">
                    {t('annotation.textHighlight')}
                  </label>
                  <input
                    id="clip-inspector-text-highlight"
                    data-testid="clip-inspector-text-highlight"
                    aria-label={t('annotation.textHighlight')}
                    type="checkbox"
                    checked={selectedAnnotations
                      .filter((candidate) => candidate.type === 'text')
                      .every((candidate) => !!candidate.style.textHighlight)}
                    onChange={(event) => {
                      const textHighlight = event.target.checked;
                      onUpdateSelectedStyles((candidate) => (
                        candidate.type === 'text'
                          ? { ...candidate.style, textHighlight }
                          : candidate.style
                      ));
                    }}
                  />
                </>
              )}

              {selectedObjectCount === 1 && annotation.type === 'shadow' && (
                <>
                  <label className="text-muted" htmlFor="clip-inspector-shadow-radius">
                    {t('annotation.radius')}
                  </label>
                  <input
                    id="clip-inspector-shadow-radius"
                    data-testid="clip-inspector-shadow-radius"
                    className="clip-stroke-width-input w-full"
                    style={{ width: '100%' }}
                    type="number"
                    min={1}
                    max={2000}
                    step={1}
                    value={Math.round(shadowRadius ?? 1)}
                    onChange={(event) => {
                      onUpdateShadowGeometry({ r: Math.max(1, Number(event.target.value) || 1) });
                    }}
                  />

                  <label className="text-muted" htmlFor="clip-inspector-shadow-spread">
                    {t('annotation.spread')}
                  </label>
                  <input
                    id="clip-inspector-shadow-spread"
                    data-testid="clip-inspector-shadow-spread"
                    type="range"
                    min={5}
                    max={180}
                    step={1}
                    value={Math.round(shadowSpread ?? 50)}
                    onChange={(event) => {
                      const spreadDeg = Math.max(5, Math.min(180, Number(event.target.value) || 50));
                      onUpdateShadowGeometry({ spreadDeg });
                    }}
                  />
                </>
              )}
            </div>
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
          {selectedObjectCount === 1 && (
            <div className="grid grid-cols-2 gap-1">
              <button onClick={onAddKeyframe} disabled={hasPositionKeyframe}>{t('clip.keyframeHere')}</button>
              <button onClick={onDeleteKeyframe} disabled={!hasPositionKeyframe && !hasVisibilityKeyframe}>{t('clip.deleteKeyframe')}</button>
            </div>
          )}
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
      </fieldset>
    </section>
  );
}
