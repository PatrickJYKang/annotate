"use client";

import type { Clip } from '../../lib/types/clip';
import type { ProjectManifestV1 } from '../../lib/types/project';
import type { Presentation, PresentationSlide, PresentationTransition, StillSlide, TitleSlide, ClipSlide } from '../../lib/types/presentation';
import type {
  PresentationPlayerState,
  PresentationTransitionPreview,
} from '../../lib/presentation/playerController';
import type { AnnotationsV1, ExportShape } from '../../lib/export/d7Render';
import type { LoadedAnnotationDocument } from '../../lib/fs/annotationStorage';

export interface PresentationInspectorProps {
  presentation: Presentation;
  manifest: ProjectManifestV1;
  clips?: Clip[];
  selectedSlideIndex: number;
  state: PresentationPlayerState;
  annotationsByStillId: Record<string, AnnotationsV1 | null>;
  annotationDocumentsByStillId: Record<string, LoadedAnnotationDocument[]>;
  currentTransition: PresentationTransitionPreview | null;
  onPreviewTransition: () => void;
  canUseMatchVideo: boolean;
  transitionValidationMessage: string | null;
  onDeleteSelectedSlide: () => void;
  onUpdateSelectedSlide: (updater: (slide: PresentationSlide) => PresentationSlide, immediate?: boolean) => void;
  onUpdateSelectedTransition: (updater: (transition: PresentationTransition) => PresentationTransition) => void;
}

function formatTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms || 0));
  let remaining = clamped;
  const hh = Math.floor(remaining / 3600000);
  remaining %= 3600000;
  const mm = Math.floor(remaining / 60000);
  remaining %= 60000;
  const ss = Math.floor(remaining / 1000);
  const mss = remaining % 1000;
  if (hh > 0) {
    return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(mss).padStart(3, '0')}`;
  }
  return `${mm}:${String(ss).padStart(2, '0')}.${String(mss).padStart(3, '0')}`;
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toMatchVideoTransition(transition: PresentationTransition): Extract<PresentationTransition, { mode: 'match_video' }> {
  if (transition.mode === 'match_video') {
    return transition;
  }
  return {
    mode: 'match_video',
    hideAnnotationsDuringPlayback: true,
  };
}

function formatNumberInput(value?: number): string {
  return value == null ? '' : String(value);
}

function formatAnnotationLabel(shape: ExportShape): string {
  if (shape.type === 'text' && shape.text?.trim()) {
    return `${shape.type} · ${shape.text.trim().slice(0, 32)}`;
  }
  return `${shape.type} · ${shape.id}`;
}

function updateAnnotationCue(
  slide: StillSlide,
  annotationId: string,
  field: 'enterAtMs' | 'exitAtMs',
  value: number | undefined,
): StillSlide {
  const currentCues = slide.annotationCues ?? [];
  const existingCue = currentCues.find((cue) => cue.annotationId === annotationId) ?? { annotationId };
  const nextCue = {
    ...existingCue,
    [field]: value,
  };
  const nextCues = currentCues.filter((cue) => cue.annotationId !== annotationId);
  if (nextCue.enterAtMs != null || nextCue.exitAtMs != null) {
    nextCues.push(nextCue);
  }
  return {
    ...slide,
    annotationCues: nextCues.length > 0 ? nextCues : undefined,
  };
}

function setAnnotationSetSelection(slide: StillSlide, nextIds: string[], allIds: string[]): StillSlide {
  const normalized = Array.from(new Set(nextIds));
  const everySelected = allIds.length > 0 && normalized.length === allIds.length && allIds.every((id) => normalized.includes(id));
  return {
    ...slide,
    annotationSetIds: everySelected ? undefined : normalized,
  };
}

function toggleAnnotationSetSelection(slide: StillSlide, annotationSetId: string, allIds: string[]): StillSlide {
  const currentIds = slide.annotationSetIds ?? allIds;
  const currentSet = new Set(currentIds);
  if (currentSet.has(annotationSetId)) {
    currentSet.delete(annotationSetId);
  } else {
    currentSet.add(annotationSetId);
  }
  return setAnnotationSetSelection(slide, Array.from(currentSet), allIds);
}

function updateAnnotationSetCue(
  slide: StillSlide,
  annotationSetId: string,
  field: 'enterAtMs' | 'exitAtMs',
  value: number | undefined,
): StillSlide {
  const currentCues = slide.annotationSetCues ?? [];
  const existingCue = currentCues.find((cue) => cue.annotationSetId === annotationSetId) ?? { annotationSetId };
  const nextCue = {
    ...existingCue,
    [field]: value,
  };
  const nextCues = currentCues.filter((cue) => cue.annotationSetId !== annotationSetId);
  if (nextCue.enterAtMs != null || nextCue.exitAtMs != null) {
    nextCues.push(nextCue);
  }
  return {
    ...slide,
    annotationSetCues: nextCues.length > 0 ? nextCues : undefined,
  };
}

export default function PresentationInspector({
  presentation,
  manifest,
  clips = [],
  selectedSlideIndex,
  state,
  annotationsByStillId,
  annotationDocumentsByStillId,
  currentTransition,
  onPreviewTransition,
  canUseMatchVideo,
  transitionValidationMessage,
  onDeleteSelectedSlide,
  onUpdateSelectedSlide,
  onUpdateSelectedTransition,
}: PresentationInspectorProps) {
  const selectedSlide = selectedSlideIndex >= 0 ? presentation.slides[selectedSlideIndex] : null;
  const selectedStill = selectedSlide?.kind === 'still'
    ? manifest.stills.find((still) => still.id === selectedSlide.stillId) ?? null
    : null;
  const selectedClip = selectedSlide?.kind === 'clip'
    ? clips.find((clip) => clip.id === selectedSlide.clipId) ?? null
    : null;
  const selectedMark = selectedStill?.sourceMarkId
    ? manifest.marks.find((mark) => mark.id === selectedStill.sourceMarkId) ?? null
    : null;
  const selectedAnnotations = selectedStill ? annotationsByStillId[selectedStill.id] ?? null : null;
  const selectedAnnotationDocuments = selectedStill ? annotationDocumentsByStillId[selectedStill.id] ?? [] : [];
  const annotationShapes = selectedAnnotations?.shapes ?? [];
  const annotationCount = annotationShapes.length;
  const annotationDocumentCount = selectedAnnotationDocuments.length;
  const currentTransitionMode = currentTransition?.transition.mode ?? 'cut';
  const transitionConfig = currentTransition?.transition.mode === 'match_video' ? currentTransition.transition : null;
  const cueByAnnotationId = new Map(
    selectedSlide?.kind === 'still'
      ? (selectedSlide.annotationCues ?? []).map((cue) => [cue.annotationId, cue] as const)
      : [],
  );
  const cueByAnnotationSetId = new Map(
    selectedSlide?.kind === 'still'
      ? (selectedSlide.annotationSetCues ?? []).map((cue) => [cue.annotationSetId, cue] as const)
      : [],
  );
  const visibleAnnotationSetIds = new Set(
    selectedSlide?.kind === 'still'
      ? (selectedSlide.annotationSetIds ?? selectedAnnotationDocuments.map((entry) => entry.entry.id))
      : [],
  );
  const usesAnnotationSetSelection = selectedAnnotationDocuments.length > 0;
  const allAnnotationSetIds = selectedAnnotationDocuments.map((entry) => entry.entry.id);

  return (
    <div className="w-[320px] shrink-0 min-h-0 border-l border-subtle bg-surface p-4 overflow-y-auto flex flex-col gap-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted">Presentation</div>
        <div className="text-lg font-semibold mt-1">{presentation.name}</div>
        <div className="text-sm text-muted mt-2">{presentation.slides.length} slides · {presentation.transitions.length} transitions</div>
      </div>

      <div className="border border-subtle rounded p-3">
        <div className="text-xs uppercase tracking-wide text-muted">Current view</div>
        <div className="text-sm font-medium mt-2">
          {state.mode === 'video'
            ? state.source === 'transition'
              ? 'Transition preview'
              : 'Retrieved mark preview'
            : state.mode === 'clip'
              ? 'Clip slide'
            : state.mode === 'still'
              ? 'Still slide'
              : state.mode === 'title'
                ? 'Title slide'
                : state.mode === 'missing'
                  ? 'Missing asset'
                  : 'Empty presentation'}
        </div>
      </div>

      <div className="border border-subtle rounded p-3 flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wide text-muted">Selected slide</div>
        {selectedSlide ? (
          <>
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium flex-1">Slide {selectedSlideIndex + 1}</div>
              <button onClick={onDeleteSelectedSlide} className="px-2 py-1 text-xs cursor-pointer text-danger">Delete</button>
            </div>
            <div className="text-sm text-muted">Kind: {selectedSlide.kind}</div>
            {selectedSlide.kind === 'title' ? (
              <>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Template
                  <select
                    value={selectedSlide.template}
                    onChange={(e) => onUpdateSelectedSlide((slide) => ({
                      ...(slide as TitleSlide),
                      template: e.target.value as TitleSlide['template'],
                    }), true)}
                    className="text-sm"
                  >
                    <option value="title">title</option>
                    <option value="section">section</option>
                    <option value="divider">divider</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Title
                  <input
                    value={selectedSlide.title}
                    onChange={(e) => onUpdateSelectedSlide((slide) => ({ ...(slide as TitleSlide), title: e.target.value }))}
                    onBlur={() => onUpdateSelectedSlide((slide) => slide, true)}
                    className="text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Body
                  <textarea
                    value={selectedSlide.body ?? ''}
                    onChange={(e) => onUpdateSelectedSlide((slide) => ({ ...(slide as TitleSlide), body: e.target.value }))}
                    onBlur={() => onUpdateSelectedSlide((slide) => slide, true)}
                    rows={5}
                    className="text-sm resize-y"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Notes
                  <textarea
                    value={selectedSlide.notes ?? ''}
                    onChange={(e) => onUpdateSelectedSlide((slide) => ({ ...(slide as TitleSlide), notes: e.target.value }))}
                    onBlur={() => onUpdateSelectedSlide((slide) => slide, true)}
                    rows={4}
                    className="text-sm resize-y"
                  />
                </label>
              </>
            ) : selectedSlide.kind === 'clip' ? (
              <>
                <div className="text-sm text-muted">Clip: {selectedSlide.clipId}</div>
                {selectedClip ? (
                  <>
                    <div className="text-sm text-muted">Video: {selectedClip.videoId}</div>
                    <div className="text-sm text-muted">Range: {formatTimestamp(selectedClip.startMs)} → {formatTimestamp(selectedClip.endMs)}</div>
                    <div className="text-sm text-muted">Annotations: {selectedClip.annotations.length}</div>
                  </>
                ) : (
                  <div className="text-sm text-danger">Clip asset is missing from disk.</div>
                )}
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Notes
                  <textarea
                    value={selectedSlide.notes ?? ''}
                    onChange={(e) => onUpdateSelectedSlide((slide) => ({ ...(slide as ClipSlide), notes: e.target.value }))}
                    onBlur={() => onUpdateSelectedSlide((slide) => slide, true)}
                    rows={4}
                    className="text-sm resize-y"
                  />
                </label>
              </>
            ) : (
              <>
                <div className="text-sm text-muted">Still: {selectedSlide.stillId}</div>
                <div className="text-sm text-muted">Annotations: {annotationCount}</div>
                <div className="text-sm text-muted">Annotation sets: {annotationDocumentCount}</div>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={selectedSlide.showAnnotations !== false}
                    onChange={(e) => onUpdateSelectedSlide((slide) => ({
                      ...slide,
                      showAnnotations: e.target.checked,
                    }), true)}
                  />
                  Show annotations
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Notes
                  <textarea
                    value={selectedSlide.notes ?? ''}
                    onChange={(e) => onUpdateSelectedSlide((slide) => ({ ...slide, notes: e.target.value }))}
                    onBlur={() => onUpdateSelectedSlide((slide) => slide, true)}
                    rows={4}
                    className="text-sm resize-y"
                  />
                </label>
                {selectedStill && (
                  <>
                    <div className="text-sm text-muted">Video: {selectedStill.videoId}</div>
                    <div className="text-sm text-muted">Timestamp: {Math.round(selectedStill.t_ms)}ms</div>
                  </>
                )}
                {selectedMark && (
                  <div className="text-sm text-muted">Source mark: {selectedMark.id}</div>
                )}
                {usesAnnotationSetSelection ? (
                  <div className="border border-subtle rounded p-3 flex flex-col gap-2">
                    <div className="text-xs uppercase tracking-wide text-muted">Annotation sets</div>
                    {selectedSlide.showAnnotations === false && (
                      <div className="text-xs text-muted">This slide currently hides annotations. Set timings and selection will be preserved.</div>
                    )}
                    {selectedAnnotationDocuments.length > 0 ? (
                      selectedAnnotationDocuments.map(({ entry, document }) => {
                        const cue = cueByAnnotationSetId.get(entry.id);
                        const label = document.label || entry.label || (entry.id === 'default' ? 'Default annotations' : `Annotation set ${entry.id}`);
                        return (
                          <div key={entry.file} className="rounded border border-subtle bg-canvas px-2 py-2 flex flex-col gap-2">
                            <label className="flex items-start gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={visibleAnnotationSetIds.has(entry.id)}
                                onChange={() => onUpdateSelectedSlide((slide) => (
                                  slide.kind === 'still'
                                    ? toggleAnnotationSetSelection(slide, entry.id, allAnnotationSetIds)
                                    : slide
                                ))}
                                onBlur={() => onUpdateSelectedSlide((slide) => slide, true)}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium break-all">{label}</div>
                                <div className="text-[11px] text-muted break-all mt-1">{entry.id} · {document.shapes.length} shapes</div>
                              </div>
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="flex flex-col gap-1 text-[11px] text-muted">
                                Enter (ms)
                                <input
                                  type="number"
                                  step="1"
                                  value={formatNumberInput(cue?.enterAtMs)}
                                  onChange={(e) => onUpdateSelectedSlide((slide) => (
                                    slide.kind === 'still'
                                      ? updateAnnotationSetCue(slide, entry.id, 'enterAtMs', parseOptionalNumber(e.target.value))
                                      : slide
                                  ))}
                                  onBlur={() => onUpdateSelectedSlide((slide) => slide, true)}
                                  className="text-sm"
                                />
                              </label>
                              <label className="flex flex-col gap-1 text-[11px] text-muted">
                                Exit (ms)
                                <input
                                  type="number"
                                  step="1"
                                  value={formatNumberInput(cue?.exitAtMs)}
                                  onChange={(e) => onUpdateSelectedSlide((slide) => (
                                    slide.kind === 'still'
                                      ? updateAnnotationSetCue(slide, entry.id, 'exitAtMs', parseOptionalNumber(e.target.value))
                                      : slide
                                  ))}
                                  onBlur={() => onUpdateSelectedSlide((slide) => slide, true)}
                                  className="text-sm"
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-xs text-muted">This still has no saved annotation sets.</div>
                    )}
                  </div>
                ) : selectedAnnotations ? (
                  <div className="border border-subtle rounded p-3 flex flex-col gap-2">
                    <div className="text-xs uppercase tracking-wide text-muted">Annotation cues</div>
                    {selectedSlide.showAnnotations === false && (
                      <div className="text-xs text-muted">This slide currently hides annotations. Cue timings will be preserved.</div>
                    )}
                    {annotationShapes.length > 0 ? (
                      annotationShapes.map((shape) => {
                        const cue = cueByAnnotationId.get(shape.id);
                        return (
                          <div key={shape.id} className="rounded border border-subtle bg-canvas px-2 py-2 flex flex-col gap-2">
                            <div>
                              <div className="text-xs font-medium break-all">{formatAnnotationLabel(shape)}</div>
                              <div className="text-[11px] text-muted break-all mt-1">{shape.id}</div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="flex flex-col gap-1 text-[11px] text-muted">
                                Enter (ms)
                                <input
                                  type="number"
                                  step="1"
                                  value={formatNumberInput(cue?.enterAtMs)}
                                  onChange={(e) => onUpdateSelectedSlide((slide) => (
                                    slide.kind === 'still'
                                      ? updateAnnotationCue(slide, shape.id, 'enterAtMs', parseOptionalNumber(e.target.value))
                                      : slide
                                  ))}
                                  onBlur={() => onUpdateSelectedSlide((slide) => slide, true)}
                                  className="text-sm"
                                />
                              </label>
                              <label className="flex flex-col gap-1 text-[11px] text-muted">
                                Exit (ms)
                                <input
                                  type="number"
                                  step="1"
                                  value={formatNumberInput(cue?.exitAtMs)}
                                  onChange={(e) => onUpdateSelectedSlide((slide) => (
                                    slide.kind === 'still'
                                      ? updateAnnotationCue(slide, shape.id, 'exitAtMs', parseOptionalNumber(e.target.value))
                                      : slide
                                  ))}
                                  onBlur={() => onUpdateSelectedSlide((slide) => slide, true)}
                                  className="text-sm"
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-xs text-muted">This still has no saved annotations.</div>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </>
        ) : (
          <div className="text-sm text-muted">Select a slide to inspect it.</div>
        )}
      </div>

      <div className="border border-subtle rounded p-3 flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wide text-muted">Next transition</div>
        {currentTransition ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Mode
              <select
                value={currentTransitionMode}
                onChange={(e) => {
                  const value = e.target.value as PresentationTransition['mode'];
                  if (value === 'match_video') {
                    onUpdateSelectedTransition(() => ({
                      mode: 'match_video',
                      hideAnnotationsDuringPlayback: true,
                    }));
                    return;
                  }
                  onUpdateSelectedTransition(() => ({ mode: 'cut' }));
                }}
                className="text-sm"
              >
                <option value="cut">cut</option>
                <option value="match_video" disabled={!canUseMatchVideo}>match_video</option>
              </select>
            </label>
            {transitionConfig && (
              <>
                {currentTransition.sourceStartMs != null && currentTransition.sourceEndMs != null && (
                  <div className="text-sm text-muted">
                    Source range: {formatTimestamp(currentTransition.sourceStartMs)} → {formatTimestamp(currentTransition.sourceEndMs)}
                  </div>
                )}
                {currentTransition.videoId && currentTransition.startMs != null && currentTransition.endMs != null && (
                  <div className="text-sm text-muted">
                    Preview range: {currentTransition.videoId} · {formatTimestamp(currentTransition.startMs)} → {formatTimestamp(currentTransition.endMs)}
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={transitionConfig.hideAnnotationsDuringPlayback !== false}
                    onChange={(e) => onUpdateSelectedTransition((transition) => ({
                      ...toMatchVideoTransition(transition),
                      hideAnnotationsDuringPlayback: e.target.checked,
                    }))}
                  />
                  Hide annotations during playback
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Playback rate
                  <input
                    type="number"
                    step="0.05"
                    min="0.05"
                    value={transitionConfig.playbackRate ?? 1}
                    onChange={(e) => onUpdateSelectedTransition((transition) => ({
                      ...toMatchVideoTransition(transition),
                      playbackRate: parseOptionalNumber(e.target.value),
                    }))}
                    className="text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Start trim (ms)
                  <input
                    type="number"
                    step="1"
                    value={transitionConfig.startOffsetMs ?? 0}
                    onChange={(e) => onUpdateSelectedTransition((transition) => ({
                      ...toMatchVideoTransition(transition),
                      startOffsetMs: parseOptionalNumber(e.target.value),
                    }))}
                    className="text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  End trim (ms)
                  <input
                    type="number"
                    step="1"
                    value={transitionConfig.endOffsetMs ?? 0}
                    onChange={(e) => onUpdateSelectedTransition((transition) => ({
                      ...toMatchVideoTransition(transition),
                      endOffsetMs: parseOptionalNumber(e.target.value),
                    }))}
                    className="text-sm"
                  />
                </label>
              </>
            )}
            {!canUseMatchVideo && transitionValidationMessage && (
              <div className="text-sm text-danger">{transitionValidationMessage}</div>
            )}
            {!currentTransition.playable && currentTransition.reason && (
              <div className="text-sm text-danger">{currentTransition.reason}</div>
            )}
            <button onClick={onPreviewTransition} className="px-3 py-1.5 text-sm cursor-pointer w-fit" disabled={!currentTransition.playable}>
              Preview transition
            </button>
          </>
        ) : (
          <div className="text-sm text-muted">No following slide.</div>
        )}
      </div>
    </div>
  );
}
