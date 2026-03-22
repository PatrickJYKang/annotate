"use client";

import { useEffect, useRef, useState } from 'react';
import type { Presentation } from '../../lib/types/presentation';

export interface PresentationDeckStripProps {
  presentation: Presentation;
  selectedSlideIndex: number;
  thumbnailUrlByStillId: Record<string, string>;
  onSelectSlide: (slideIndex: number) => void;
  onReorderSlide?: (fromIndex: number, toIndex: number) => void;
  onDeleteSlide?: (slideIndex: number) => void;
}

export default function PresentationDeckStrip({
  presentation,
  selectedSlideIndex,
  thumbnailUrlByStillId,
  onSelectSlide,
  onReorderSlide,
  onDeleteSlide,
}: PresentationDeckStripProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const selectedCardRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!selectedCardRef.current) return;
    selectedCardRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [selectedSlideIndex]);

  return (
    <div className="shrink-0 border-t border-subtle bg-surface">
      <div className="flex items-center justify-between gap-4 px-4 py-2 border-b border-subtle">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">Deck</div>
          <div className="text-sm text-muted mt-1">Drag to reorder slides and use the transition chips to understand playback flow.</div>
        </div>
        <div className="text-xs text-muted">{presentation.slides.length} slides</div>
      </div>
      <div className="px-4 py-3 overflow-x-auto">
      <div className="flex items-stretch min-w-max">
        {presentation.slides.map((slide, index) => {
          const isSelected = index === selectedSlideIndex;
          const transition = presentation.transitions[index];
          const transitionLabel = transition?.mode === 'match_video' ? 'match video' : 'cut';
          return (
            <div key={slide.id} className="flex items-stretch gap-3 pr-3">
              <button
                ref={isSelected ? selectedCardRef : null}
                draggable={!!onReorderSlide}
                onDragStart={(e) => {
                  if (!onReorderSlide) return;
                  e.dataTransfer.setData('application/x-presentation-slide-index', String(index));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (!onReorderSlide) return;
                  if (e.dataTransfer.types.includes('application/x-presentation-slide-index')) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDragEnter={() => {
                  if (!onReorderSlide) return;
                  setDragOverIndex(index);
                }}
                onDragLeave={() => {
                  if (dragOverIndex === index) setDragOverIndex(null);
                }}
                onDrop={(e) => {
                  if (!onReorderSlide) return;
                  const raw = e.dataTransfer.getData('application/x-presentation-slide-index');
                  const fromIndex = Number(raw);
                  if (Number.isFinite(fromIndex)) {
                    e.preventDefault();
                    onReorderSlide(fromIndex, index);
                  }
                  setDragOverIndex(null);
                }}
                onDragEnd={() => setDragOverIndex(null)}
                onClick={() => onSelectSlide(index)}
                className={`group relative w-[208px] shrink-0 text-left border overflow-hidden transition-colors ${
                  isSelected
                    ? 'border-accent bg-selected'
                    : dragOverIndex === index
                      ? 'border-info bg-hover'
                      : 'border-subtle bg-canvas hover:bg-hover'
                }`}
              >
                <div className="absolute left-2 top-2 z-10 px-2 py-1 border border-black/30 bg-black/60 text-[10px] uppercase tracking-[0.18em] text-white">
                  {slide.kind}
                </div>
                <div className="h-[112px] bg-black/20 flex items-center justify-center overflow-hidden">
                  {slide.kind === 'still' ? (
                    thumbnailUrlByStillId[slide.stillId] ? (
                      <img src={thumbnailUrlByStillId[slide.stillId]} alt="Slide thumbnail" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-xs text-muted px-3 text-center">Still thumbnail unavailable</div>
                    )
                  ) : slide.kind === 'clip' ? (
                    <div className="px-3 py-2 w-full h-full flex flex-col justify-center bg-gradient-to-br from-slate-900 to-slate-800">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-300">clip</div>
                      <div className="mt-2 text-sm font-semibold text-white line-clamp-2">{slide.clipId}</div>
                      <div className="mt-2 text-[11px] text-slate-400">Video segment playback</div>
                    </div>
                  ) : (
                    <div className="px-3 py-2 w-full h-full flex flex-col justify-center bg-gradient-to-br from-slate-800 to-slate-950">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-300">{slide.template}</div>
                      <div className="mt-2 text-sm font-semibold text-white line-clamp-3">{slide.title || 'Untitled slide'}</div>
                    </div>
                  )}
                </div>
                <div className="px-3 py-3 border-t border-subtle bg-surface">
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted flex-1">Slide {index + 1}</div>
                    {onReorderSlide && <div className="text-[10px] uppercase tracking-wide text-muted">Drag</div>}
                    {onDeleteSlide && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSlide(index);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            onDeleteSlide(index);
                          }
                        }}
                        className="text-[11px] text-danger cursor-pointer"
                      >
                        Delete
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-medium truncate mt-1">
                    {slide.kind === 'still'
                      ? `Still ${slide.stillId}`
                      : slide.kind === 'clip'
                        ? `Clip ${slide.clipId}`
                        : slide.title || 'Untitled title slide'}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted">
                    {slide.kind === 'still' ? (
                      <>
                        <span className="px-1.5 py-0.5 border border-subtle bg-canvas">still</span>
                        <span className="px-1.5 py-0.5 border border-subtle bg-canvas">annotations</span>
                      </>
                    ) : slide.kind === 'clip' ? (
                      <>
                        <span className="px-1.5 py-0.5 border border-subtle bg-canvas">clip</span>
                        <span className="px-1.5 py-0.5 border border-subtle bg-canvas">video</span>
                      </>
                    ) : (
                      <span className="px-1.5 py-0.5 border border-subtle bg-canvas">{slide.template}</span>
                    )}
                  </div>
                </div>
              </button>
              {index < presentation.transitions.length && (
                <div className="shrink-0 flex items-center justify-center px-1">
                  <div className={`px-2 py-1 border text-[10px] uppercase tracking-[0.18em] ${
                    transition?.mode === 'match_video' ? 'border-accent text-accent bg-selected' : 'border-subtle text-muted bg-canvas'
                  }`}>
                    {transitionLabel}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {presentation.slides.length === 0 && (
          <div className="text-sm text-muted px-1 py-2">No slides yet.</div>
        )}
      </div>
      </div>
    </div>
  );
}
