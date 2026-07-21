"use client";

import { useEffect, useState } from 'react';
import type { PresentationClipAsset, PresentationAssetIndex } from '../../lib/presentation/authoring';
import {
  encodePresentationAssetDrag,
  PRESENTATION_ASSET_MIME,
  type PresentationAssetDrag,
} from '../../lib/presentation/drag';
import { useLocale } from '../../lib/i18n';

interface PresentationAssetBrowserProps {
  index: PresentationAssetIndex;
  selectedClipId: string | null;
  onPreviewClip: (clipId: string) => void;
}

function frameLabel(frame: number, fps: number | undefined): string {
  if (!fps) return `f${frame}`;
  const seconds = frame / fps;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, '0')} · f${frame}`;
}

function startDrag(event: React.DragEvent, payload: PresentationAssetDrag) {
  event.dataTransfer.setData(PRESENTATION_ASSET_MIME, encodePresentationAssetDrag(payload));
  event.dataTransfer.effectAllowed = 'copy';
}

function ClipAssetRow({
  asset,
  selected,
  onPreview,
}: {
  asset: PresentationClipAsset;
  selected: boolean;
  onPreview: () => void;
}) {
  const { t, formatNumber } = useLocale();
  const [pinsOpen, setPinsOpen] = useState(false);
  const clip = asset.clip;
  return (
    <div className={`border-t border-border first:border-t-0 ${selected ? 'bg-selected' : ''}`} data-testid={`presentation-asset-${clip.id}`}>
      <div className="flex items-stretch">
        <button
          className="min-w-0 flex-1 border-0 bg-transparent px-2 py-1.5 text-left"
          draggable
          onDragStart={(event) => startDrag(event, { kind: 'clip', clipId: clip.id })}
          onClick={onPreview}
        >
          <span className="block truncate text-xs font-semibold">{clip.label || clip.id}</span>
          <span className="block font-mono text-[10px] text-muted">
            {frameLabel(clip.startFrame, asset.video?.fps)} → f{formatNumber(clip.endFrame - 1)}
          </span>
        </button>
        <button
          className="w-8 border-0 border-l border-solid border-border bg-transparent text-xs"
          aria-label={t(pinsOpen ? 'presentation.collapsePins' : 'presentation.expandPins', { label: clip.label || clip.id })}
          onClick={() => setPinsOpen((open) => !open)}
        >
          {pinsOpen ? '▾' : '▸'}
        </button>
      </div>
      {pinsOpen && (
        <div className="border-t border-border bg-canvas/40 py-1">
          {clip.pins.length === 0 ? (
            <p className="m-0 px-4 py-1 text-[11px] text-muted">{t('presentation.noPins')}</p>
          ) : clip.pins.map((pin) => (
            <button
              key={pin.id}
              draggable
              className="block w-full border-0 bg-transparent px-5 py-1 text-left text-[11px] text-secondary hover:bg-hover"
              onDragStart={(event) => startDrag(event, { kind: 'pin', clipId: clip.id, pinId: pin.id })}
              onClick={onPreview}
              data-testid={`presentation-pin-asset-${pin.id}`}
            >
              <span className="font-mono">f{formatNumber(pin.frame)}</span>
              <span className="ml-2">{pin.label || pin.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetBucket({
  label,
  assets,
  selectedClipId,
  onPreviewClip,
  defaultOpen = false,
}: {
  label: string;
  assets: PresentationClipAsset[];
  selectedClipId: string | null;
  onPreviewClip: (clipId: string) => void;
  defaultOpen?: boolean;
}) {
  const { formatNumber } = useLocale();
  const [open, setOpen] = useState(defaultOpen || assets.length > 0);
  useEffect(() => {
    if (assets.length > 0) setOpen(true);
  }, [assets.length]);
  return (
    <section className="border-b border-border last:border-b-0">
      <button className="flex w-full items-center border-0 bg-raised px-2 py-1.5 text-left text-xs" onClick={() => setOpen((value) => !value)}>
        <span className="mr-1.5">{open ? '▾' : '▸'}</span>
        <strong className="min-w-0 flex-1 truncate">{label}</strong>
        <span className="font-mono text-[10px] text-muted">{formatNumber(assets.length)}</span>
      </button>
      {open && assets.map((asset) => (
        <ClipAssetRow
          key={asset.clip.id}
          asset={asset}
          selected={selectedClipId === asset.clip.id}
          onPreview={() => onPreviewClip(asset.clip.id)}
        />
      ))}
    </section>
  );
}

export default function PresentationAssetBrowser({
  index,
  selectedClipId,
  onPreviewClip,
}: PresentationAssetBrowserProps) {
  const t = useLocale().t;
  const [view, setView] = useState<'tags' | 'chronological'>('tags');
  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-surface" data-testid="presentation-assets">
      <header className="panel-heading h-auto flex-wrap py-2">
        <h2>{t('presentation.assets')}</h2>
        <div className="segmented">
          <button aria-pressed={view === 'tags'} onClick={() => setView('tags')}>{t('presentation.tags')}</button>
          <button aria-pressed={view === 'chronological'} onClick={() => setView('chronological')}>{t('presentation.time')}</button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'chronological' ? (
          <AssetBucket label={t('presentation.chronological')} assets={index.chronological} selectedClipId={selectedClipId} onPreviewClip={onPreviewClip} defaultOpen />
        ) : (
          <>
            {index.groups.map((group) => group.buttons.map((button) => (
              <AssetBucket
                key={button.id}
                label={`${group.label} · ${button.label}`}
                assets={button.clips}
                selectedClipId={selectedClipId}
                onPreviewClip={onPreviewClip}
              />
            )))}
            <AssetBucket label={t('tagTree.untagged')} assets={index.untagged} selectedClipId={selectedClipId} onPreviewClip={onPreviewClip} />
            <AssetBucket label={t('tagTree.unknown')} assets={index.unknown} selectedClipId={selectedClipId} onPreviewClip={onPreviewClip} />
          </>
        )}
      </div>
    </aside>
  );
}
