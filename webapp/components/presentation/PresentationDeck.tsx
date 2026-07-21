"use client";

import type { Clip } from '../../lib/types/clip';
import type { PresentationSlide } from '../../lib/types/presentation';
import {
  decodePresentationAssetDrag,
  PRESENTATION_ASSET_MIME,
  PRESENTATION_SLIDE_MIME,
  type PresentationAssetDrag,
} from '../../lib/presentation/drag';
import { useLocale, type Translate } from '../../lib/i18n';

interface PresentationDeckProps {
  slides: PresentationSlide[];
  clips: readonly Clip[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onInsertAsset: (payload: PresentationAssetDrag, index: number) => void;
  onMoveSlide: (fromIndex: number, toIndex: number) => void;
}

function slideLabel(slide: PresentationSlide, clipsById: Map<string, Clip>, t: Translate, formatNumber: (value: number) => string): string {
  if (slide.kind === 'title') return slide.title || t('presentation.untitledSlide');
  const clip = clipsById.get(slide.clipId);
  if (slide.kind === 'clip') return clip?.label || clip?.id || t('presentation.missingClipLabel', { id: slide.clipId });
  const pin = clip?.pins.find((candidate) => candidate.id === slide.pinId);
  return pin?.label || t('presentation.pinFallback', {
    frame: pin ? formatNumber(pin.frame) : '?',
    id: slide.pinId,
  });
}

function slideKindLabel(slide: PresentationSlide, t: Translate): string {
  if (slide.kind === 'clip') return t('presentation.slideType.clip');
  if (slide.kind === 'pin') return t('presentation.slideType.pin');
  return t(`presentation.slideType.${slide.template}`);
}

export default function PresentationDeck({
  slides,
  clips,
  selectedIndex,
  onSelect,
  onInsertAsset,
  onMoveSlide,
}: PresentationDeckProps) {
  const { t, formatNumber } = useLocale();
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));

  const receiveDrop = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    const rawSlideIndex = event.dataTransfer.getData(PRESENTATION_SLIDE_MIME);
    const slideIndex = rawSlideIndex === '' ? Number.NaN : Number(rawSlideIndex);
    if (Number.isInteger(slideIndex) && slideIndex >= 0) {
      onMoveSlide(slideIndex, index);
      return;
    }
    const payload = decodePresentationAssetDrag(event.dataTransfer.getData(PRESENTATION_ASSET_MIME));
    if (payload) onInsertAsset(payload, index);
  };

  return (
    <div
      className="flex h-full min-h-[96px] items-stretch gap-2 overflow-x-auto bg-surface p-2"
      data-testid="presentation-deck"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => receiveDrop(event, slides.length)}
    >
      {slides.length === 0 && (
        <div className="empty-state min-w-[280px]" aria-hidden="true" />
      )}
      {slides.map((slide, index) => (
        <button
          key={slide.id}
          draggable
          data-testid={`presentation-slide-${slide.id}`}
          onDragStart={(event) => {
            event.dataTransfer.setData(PRESENTATION_SLIDE_MIME, String(index));
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.stopPropagation();
            receiveDrop(event, index);
          }}
          onClick={() => onSelect(index)}
          className={`w-[180px] shrink-0 border px-3 py-2 text-left ${selectedIndex === index ? 'border-focus bg-selected' : 'border-border bg-raised'}`}
        >
          <span className="block font-mono text-[10px] text-muted">{formatNumber(index + 1)} · {slideKindLabel(slide, t)}</span>
          <strong className="mt-1 block truncate text-xs">{slideLabel(slide, clipsById, t, formatNumber)}</strong>
        </button>
      ))}
    </div>
  );
}
