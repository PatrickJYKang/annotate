"use client";

import type { ClipPin, Clip } from '../../lib/types/clip';
import type {
  ClipPauseCue,
  ClipSlide,
  PinAnnotationCue,
  PinSlide,
  PresentationSlide,
  PresentationTransition,
} from '../../lib/types/presentation';
import { useLocale } from '../../lib/i18n';

interface PresentationInspectorProps {
  slide: PresentationSlide | null;
  clip: Clip | null;
  transitionAfter: PresentationTransition | null;
  transitionError?: string | null;
  onSlideChange: (slide: PresentationSlide) => void;
  onTransitionChange: (transition: PresentationTransition) => void;
  onDelete: () => void;
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function updateAnnotationCue(
  cues: PinAnnotationCue[] | undefined,
  annotationId: string,
  field: 'enterAtMs' | 'exitAtMs',
  value: number | undefined,
): PinAnnotationCue[] {
  const existing = cues?.find((cue) => cue.annotationId === annotationId) ?? { annotationId };
  const next = { ...existing, [field]: value };
  const retained = (cues ?? []).filter((cue) => cue.annotationId !== annotationId);
  if (next.enterAtMs === undefined && next.exitAtMs === undefined) return retained;
  return [...retained, next];
}

function AnnotationDocumentControls({
  pin,
  selectedIds,
  cues,
  onSelectionChange,
  onCuesChange,
}: {
  pin: ClipPin;
  selectedIds: string[] | null | undefined;
  cues: PinAnnotationCue[] | undefined;
  onSelectionChange: (ids: string[] | null) => void;
  onCuesChange: (cues: PinAnnotationCue[]) => void;
}) {
  const t = useLocale().t;
  const selected = selectedIds == null ? new Set(pin.annotations.map((reference) => reference.id)) : new Set(selectedIds);
  return (
    <div className="mt-2 border-t border-border pt-2">
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={selectedIds == null} onChange={(event) => onSelectionChange(event.target.checked ? null : [])} />
        {t('presentation.includeAllAnnotations')}
      </label>
      {pin.annotations.map((reference) => {
        const cue = cues?.find((candidate) => candidate.annotationId === reference.id);
        return (
          <div key={reference.id} className="mt-2 border-t border-border pt-2">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={selected.has(reference.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(reference.id);
                  else next.delete(reference.id);
                  onSelectionChange(Array.from(next));
                }}
              />
              {reference.label || reference.id}
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-[10px] text-muted">{t('presentation.enterMs')}
                <input
                  className="mt-1 w-full"
                  type="number"
                  min={0}
                  value={cue?.enterAtMs ?? ''}
                  onChange={(event) => onCuesChange(updateAnnotationCue(cues, reference.id, 'enterAtMs', optionalNumber(event.target.value)))}
                />
              </label>
              <label className="text-[10px] text-muted">{t('presentation.exitMs')}
                <input
                  className="mt-1 w-full"
                  type="number"
                  min={0}
                  value={cue?.exitAtMs ?? ''}
                  onChange={(event) => onCuesChange(updateAnnotationCue(cues, reference.id, 'exitAtMs', optionalNumber(event.target.value)))}
                />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PinSlideControls({
  slide,
  pin,
  onChange,
}: {
  slide: PinSlide;
  pin: ClipPin | null;
  onChange: (slide: PinSlide) => void;
}) {
  const t = useLocale().t;
  return (
    <>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={slide.showAnnotations} onChange={(event) => onChange({ ...slide, showAnnotations: event.target.checked })} />
        {t('presentation.showPinAnnotations')}
      </label>
      {pin && slide.showAnnotations && (
        <AnnotationDocumentControls
          pin={pin}
          selectedIds={slide.annotationIds}
          cues={slide.annotationCues}
          onSelectionChange={(annotationIds) => onChange({ ...slide, annotationIds })}
          onCuesChange={(annotationCues) => onChange({ ...slide, annotationCues })}
        />
      )}
    </>
  );
}

function pauseCueFor(slide: ClipSlide, pinId: string): ClipPauseCue {
  return slide.pauseCues?.find((cue) => cue.pinId === pinId) ?? { pinId, annotationIds: null };
}

function updatePauseCue(slide: ClipSlide, cue: ClipPauseCue): ClipSlide {
  return {
    ...slide,
    pauseCues: [...(slide.pauseCues ?? []).filter((candidate) => candidate.pinId !== cue.pinId), cue],
  };
}

function ClipSlideControls({
  slide,
  clip,
  onChange,
}: {
  slide: ClipSlide;
  clip: Clip | null;
  onChange: (slide: ClipSlide) => void;
}) {
  const { t, formatNumber } = useLocale();
  if (!clip) return <p className="text-xs text-danger">{t('presentation.missingClip', { id: slide.clipId })}</p>;
  const effectiveIds = new Set(slide.pausePins ?? clip.pins.map((pin) => pin.id));
  return (
    <>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={slide.pausePins === null}
          onChange={(event) => onChange({ ...slide, pausePins: event.target.checked ? null : [] })}
        />
        {t('presentation.autoPause')}
      </label>
      <div className="mt-2">
        {clip.pins.map((pin) => {
          const cue = pauseCueFor(slide, pin.id);
          return (
            <details key={pin.id} className="border-t border-border py-2 first:border-t-0" open={effectiveIds.has(pin.id)}>
              <summary className="cursor-pointer text-xs font-semibold">
                <label className="mr-2 inline-flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={effectiveIds.has(pin.id)}
                    onChange={(event) => {
                      const next = new Set(effectiveIds);
                      if (event.target.checked) next.add(pin.id);
                      else next.delete(pin.id);
                      onChange({ ...slide, pausePins: Array.from(next) });
                    }}
                  />
                  f{formatNumber(pin.frame)} · {pin.label || pin.id}
                </label>
              </summary>
              <label className="mt-2 block text-[10px] text-muted">{t('presentation.autoResume')}
                <input
                  className="mt-1 w-full"
                  type="number"
                  min={0}
                  value={cue.holdMs ?? ''}
                  onChange={(event) => onChange(updatePauseCue(slide, { ...cue, holdMs: optionalNumber(event.target.value) }))}
                />
              </label>
              <AnnotationDocumentControls
                pin={pin}
                selectedIds={cue.annotationIds}
                cues={cue.annotationCues}
                onSelectionChange={(annotationIds) => onChange(updatePauseCue(slide, { ...cue, annotationIds }))}
                onCuesChange={(annotationCues) => onChange(updatePauseCue(slide, { ...cue, annotationCues }))}
              />
            </details>
          );
        })}
      </div>
    </>
  );
}

export default function PresentationInspector({
  slide,
  clip,
  transitionAfter,
  transitionError,
  onSlideChange,
  onTransitionChange,
  onDelete,
}: PresentationInspectorProps) {
  const t = useLocale().t;
  if (!slide) {
    return <aside className="h-full w-full bg-surface p-3"><div className="empty-state h-24" aria-hidden="true" /></aside>;
  }
  const pin = slide.kind === 'pin' ? clip?.pins.find((candidate) => candidate.id === slide.pinId) ?? null : null;
  return (
    <aside className="h-full min-h-0 w-full overflow-y-auto bg-surface p-3" data-testid="presentation-inspector">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-border pb-2">
        <h3 className="m-0 text-xs font-semibold">{t('presentation.inspector')}</h3>
        <span className="text-xs text-muted">{t(`presentation.${slide.kind}Slide`)}</span>
      </div>

      {slide.kind === 'title' && (
        <>
          <label className="block text-xs text-muted">{t('presentation.template')}
            <select className="mt-1 w-full" value={slide.template} onChange={(event) => onSlideChange({ ...slide, template: event.target.value as typeof slide.template })}>
              <option value="title">{t('presentation.templateTitle')}</option><option value="section">{t('presentation.templateSection')}</option><option value="divider">{t('presentation.templateDivider')}</option>
            </select>
          </label>
          <label className="mt-3 block text-xs text-muted">{t('presentation.title')}
            <input className="mt-1 w-full" value={slide.title} onChange={(event) => onSlideChange({ ...slide, title: event.target.value })} />
          </label>
          <label className="mt-3 block text-xs text-muted">{t('presentation.body')}
            <textarea className="mt-1 w-full" value={slide.body ?? ''} onChange={(event) => onSlideChange({ ...slide, body: event.target.value })} />
          </label>
        </>
      )}

      {slide.kind === 'pin' && <PinSlideControls slide={slide} pin={pin} onChange={onSlideChange} />}
      {slide.kind === 'clip' && <ClipSlideControls slide={slide} clip={clip} onChange={onSlideChange} />}

      <label className="mt-3 block text-xs text-muted">{t('presentation.slideHold')}
        <input className="mt-1 w-full" type="number" min={0} value={slide.holdMs ?? ''} onChange={(event) => onSlideChange({ ...slide, holdMs: optionalNumber(event.target.value) })} />
      </label>
      {'notes' in slide && (
        <label className="mt-3 block text-xs text-muted">{t('presentation.speakerNotes')}
          <textarea className="mt-1 w-full" value={slide.notes ?? ''} onChange={(event) => onSlideChange({ ...slide, notes: event.target.value })} />
        </label>
      )}

      {transitionAfter && (
        <section className="mt-4 border-t border-border pt-3">
          <h4 className="m-0 text-xs">{t('presentation.transitionAfter')}</h4>
          <select
            className="mt-2 w-full"
            aria-label={t('presentation.transitionAfterAria')}
            value={transitionAfter.mode}
            onChange={(event) => onTransitionChange(event.target.value === 'match_video'
              ? { mode: 'match_video', hideAnnotationsDuringPlayback: true }
              : { mode: 'cut' })}
          >
            <option value="cut">{t('presentation.cut')}</option>
            <option value="match_video">{t('presentation.matchVideo')}</option>
          </select>
          {transitionAfter.mode === 'match_video' && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-[10px] text-muted">{t('presentation.startOffset')}
                <input className="mt-1 w-full" type="number" min={0} value={transitionAfter.startOffsetFrames ?? 0} onChange={(event) => onTransitionChange({ ...transitionAfter, startOffsetFrames: Math.max(0, Number(event.target.value) || 0) })} />
              </label>
              <label className="text-[10px] text-muted">{t('presentation.endOffset')}
                <input className="mt-1 w-full" type="number" max={0} value={transitionAfter.endOffsetFrames ?? 0} onChange={(event) => onTransitionChange({ ...transitionAfter, endOffsetFrames: Math.min(0, Number(event.target.value) || 0) })} />
              </label>
              <label className="col-span-2 text-[10px] text-muted">{t('presentation.playbackRate')}
                <input className="mt-1 w-full" type="number" min={0.1} step={0.1} value={transitionAfter.playbackRate ?? 1} onChange={(event) => onTransitionChange({ ...transitionAfter, playbackRate: Math.max(0.1, Number(event.target.value) || 1) })} />
              </label>
              <label className="col-span-2 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={transitionAfter.hideAnnotationsDuringPlayback} onChange={(event) => onTransitionChange({ ...transitionAfter, hideAnnotationsDuringPlayback: event.target.checked })} />
                {t('presentation.hideTransitionAnnotations')}
              </label>
            </div>
          )}
          {transitionError && <p className="mb-0 mt-2 text-xs text-danger">{transitionError}</p>}
        </section>
      )}

      <button className="button-danger mt-5 w-full" onClick={onDelete}>{t('presentation.deleteSlide')}</button>
    </aside>
  );
}
