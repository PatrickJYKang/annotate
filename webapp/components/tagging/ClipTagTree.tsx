"use client";

import type { DragEvent } from 'react';
import { boardTagTree, type TaggingBoard } from '../../lib/tagging/board';
import type { Clip } from '../../lib/types/clip';
import { useLocale } from '../../lib/i18n';

export const CLIP_DRAG_MIME = 'application/x-annotate-clip-id';

interface ClipTagTreeProps {
  board: TaggingBoard;
  clips: Clip[];
  selectedClipId: string | null;
  onSelectClip: (clip: Clip) => void;
  onDropClipOnButton: (clipId: string, buttonId: string) => void | Promise<void>;
}

function ClipRow({
  clip,
  selected,
  onSelectClip,
}: {
  clip: Clip;
  selected: boolean;
  onSelectClip: (clip: Clip) => void;
}) {
  const { t, formatNumber } = useLocale();
  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(CLIP_DRAG_MIME, clip.id);
    event.dataTransfer.setData('text/plain', clip.id);
  };

  return (
    <button
      type="button"
      draggable
      data-testid={`clip-tree-row-${clip.id}`}
      onDragStart={onDragStart}
      onClick={() => onSelectClip(clip)}
      className={`w-full border-0 border-t border-solid border-border px-2 py-2 text-left first:border-t-0 ${
        selected ? 'bg-selected' : 'bg-transparent'
      }`}
    >
      <span className="block truncate text-sm font-semibold">{clip.label || clip.id}</span>
      <span className="mt-0.5 block font-mono text-[10px] text-muted">
        {t('tagTree.frameRange', {
          start: formatNumber(clip.startFrame),
          end: formatNumber(clip.endFrame - 1),
          count: formatNumber(clip.endFrame - clip.startFrame),
        })}
      </span>
    </button>
  );
}

export default function ClipTagTree({
  board,
  clips,
  selectedClipId,
  onSelectClip,
  onDropClipOnButton,
}: ClipTagTreeProps) {
  const { t, formatNumber } = useLocale();
  const tree = boardTagTree(board);
  const knownButtons = new Set(tree.flatMap((group) => group.buttons.map((button) => button.id)));
  const untagged = clips.filter((clip) => !clip.tags.primary);
  const unknown = clips.filter((clip) => !!clip.tags.primary && !knownButtons.has(clip.tags.primary));

  const drop = (event: DragEvent<HTMLElement>, buttonId: string) => {
    event.preventDefault();
    const clipId = event.dataTransfer.getData(CLIP_DRAG_MIME)
      || event.dataTransfer.getData('text/plain');
    if (clipId) void onDropClipOnButton(clipId, buttonId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface" data-testid="clip-tag-tree">
      {untagged.length > 0 && (
        <section>
          <div className="sticky top-0 z-[1] border-b border-border bg-raised px-2 py-1.5 text-xs font-semibold text-secondary">
            {t('tagTree.untagged')}
          </div>
          {untagged.map((clip) => (
            <ClipRow
              key={clip.id}
              clip={clip}
              selected={clip.id === selectedClipId}
              onSelectClip={onSelectClip}
            />
          ))}
        </section>
      )}

      {unknown.length > 0 && (
        <section data-testid="clip-tag-unknown">
          <div className="sticky top-0 z-[1] border-b border-border bg-raised px-2 py-1.5 text-xs font-semibold text-warning">
            {t('tagTree.unknown')}
          </div>
          {unknown.map((clip) => (
            <ClipRow
              key={clip.id}
              clip={clip}
              selected={clip.id === selectedClipId}
              onSelectClip={onSelectClip}
            />
          ))}
        </section>
      )}

      {tree.map((group) => (
        <section key={group.id}>
          <div className="sticky top-0 z-[1] border-y border-border bg-raised px-2 py-1.5 text-xs font-semibold text-secondary">
            {group.label}
          </div>
          {group.buttons.map((button) => {
            const tagged = clips.filter((clip) => clip.tags.primary === button.id);
            return (
              <div
                key={button.id}
                data-testid={`clip-tag-target-${button.id}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => drop(event, button.id)}
                className="border-b border-border/60"
              >
                <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-secondary">
                  <span>{button.label}</span>
                  <span className="font-mono text-[10px] text-muted">{formatNumber(tagged.length)}</span>
                </div>
                {tagged.map((clip) => (
                  <ClipRow
                    key={clip.id}
                    clip={clip}
                    selected={clip.id === selectedClipId}
                    onSelectClip={onSelectClip}
                  />
                ))}
              </div>
            );
          })}
        </section>
      ))}

      {clips.length === 0 && <div className="empty-state m-3 flex-1" aria-hidden="true" />}
    </div>
  );
}
