"use client";

import { useEffect, useMemo, useState } from 'react';
import { videoFrame } from '../../lib/clip/frameMath';
import { createFrameRasterQueue, type FrameRasterQueue } from '../../lib/media/frameRaster';
import type { Clip } from '../../lib/types/clip';
import type { PresentationSlide } from '../../lib/types/presentation';
import {
  decodePresentationAssetDrag,
  PRESENTATION_ASSET_MIME,
  PRESENTATION_SLIDE_MIME,
  type PresentationAssetDrag,
} from '../../lib/presentation/drag';
import { useLocale, type Translate } from '../../lib/i18n';
import type { PresentationVideoResource } from './PresentationCanvas';
import PresentationTitleSlide from './PresentationTitleSlide';

interface PresentationDeckProps {
  slides: PresentationSlide[];
  clips: readonly Clip[];
  videoResources: ReadonlyMap<string, PresentationVideoResource>;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onInsertAsset: (payload: PresentationAssetDrag, index: number) => void;
  onMoveSlide: (fromIndex: number, toIndex: number) => void;
}

interface ThumbnailRequest {
  slideId: string;
  videoId: string;
  frame: number;
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

function thumbnailRequestsFor(slides: readonly PresentationSlide[], clips: readonly Clip[]): ThumbnailRequest[] {
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  return slides.flatMap((slide) => {
    if (slide.kind === 'title') return [];
    const clip = clipsById.get(slide.clipId);
    if (!clip) return [];
    const frame = slide.kind === 'clip'
      ? clip.startFrame
      : clip.pins.find((pin) => pin.id === slide.pinId)?.frame;
    return frame === undefined ? [] : [{ slideId: slide.id, videoId: clip.videoId, frame }];
  });
}

export default function PresentationDeck({
  slides,
  clips,
  videoResources,
  selectedIndex,
  onSelect,
  onInsertAsset,
  onMoveSlide,
}: PresentationDeckProps) {
  const { t, formatNumber } = useLocale();
  const clipsById = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips]);
  const requestSnapshot = JSON.stringify(thumbnailRequestsFor(slides, clips));
  const thumbnailRequests = useMemo(
    () => JSON.parse(requestSnapshot) as ThumbnailRequest[],
    [requestSnapshot],
  );
  const [thumbnailUrls, setThumbnailUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let active = true;
    const queues = new Map<string, FrameRasterQueue>();
    const urls = new Set<string>();
    const urlsByFrame = new Map<string, string>();
    setThumbnailUrls(new Map());

    void (async () => {
      const next = new Map<string, string>();
      for (const request of thumbnailRequests) {
        const resource = videoResources.get(request.videoId);
        if (!resource) continue;
        const frameKey = `${request.videoId}:${request.frame}`;
        let url = urlsByFrame.get(frameKey);
        if (!url) {
          let queue = queues.get(request.videoId);
          if (!queue) {
            queue = createFrameRasterQueue(resource.file);
            queues.set(request.videoId, queue);
          }
          try {
            const raster = await queue.rasterize({
              frame: videoFrame(request.frame),
              fps: resource.video.fps,
              outputWidth: 320,
            });
            if (!active) return;
            url = URL.createObjectURL(raster.blob);
            urls.add(url);
            urlsByFrame.set(frameKey, url);
          } catch {
            continue;
          }
        }
        next.set(request.slideId, url);
        if (active) setThumbnailUrls(new Map(next));
      }
    })();

    return () => {
      active = false;
      queues.forEach((queue) => queue.dispose());
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [thumbnailRequests, videoResources]);

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
      className="flex h-full min-h-[150px] items-start gap-2 overflow-x-auto bg-surface p-2"
      data-testid="presentation-deck"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => receiveDrop(event, slides.length)}
    >
      {slides.length === 0 && <div className="empty-state h-full min-w-[280px]" aria-hidden="true" />}
      {slides.map((slide, index) => {
        const thumbnailUrl = thumbnailUrls.get(slide.id);
        return (
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
            className={`w-[220px] shrink-0 overflow-hidden border p-0 text-left ${selectedIndex === index ? 'border-focus bg-selected' : 'border-border bg-raised'}`}
            aria-pressed={selectedIndex === index}
          >
            <div
              className="relative aspect-video overflow-hidden bg-black"
              data-testid={`presentation-slide-thumbnail-${slide.id}`}
              data-thumbnail-loaded={slide.kind === 'title' || Boolean(thumbnailUrl)}
            >
              {slide.kind === 'title' ? (
                <PresentationTitleSlide slide={slide} compact />
              ) : thumbnailUrl ? (
                <div
                  className="h-full w-full bg-contain bg-center bg-no-repeat"
                  style={{ backgroundImage: `url(${JSON.stringify(thumbnailUrl)})` }}
                />
              ) : (
                <div className="h-full w-full bg-canvas" />
              )}
              <span className="absolute left-1.5 top-1.5 bg-black/80 px-1.5 py-0.5 font-mono text-[9px] text-white">
                {formatNumber(index + 1)}
              </span>
              <span className="absolute right-1.5 top-1.5 bg-black/80 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                {slideKindLabel(slide, t)}
              </span>
            </div>
            <div className="border-t border-border px-2 py-1.5">
              <strong className="block truncate text-xs">{slideLabel(slide, clipsById, t, formatNumber)}</strong>
            </div>
          </button>
        );
      })}
    </div>
  );
}
