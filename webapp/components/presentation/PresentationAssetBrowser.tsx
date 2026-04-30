"use client";

import { useMemo, useState } from 'react';
import type { Clip } from '../../lib/types/clip';
import type { ProjectManifestV1 } from '../../lib/types/project';
import type { TaggingSchema } from '../../lib/tagging/schema';
import { ensureTaggingSelection } from '../../lib/tagging/schema';
import type {
  ClipCenteredStillGroup,
  ChronologicalMarkGroup,
  PresentationAssetIndex,
  PresentationAssetMark,
  PresentationAssetTreeNode,
} from '../../lib/presentation/authoring';
import { buildChronologicalMarkGroups, buildClipCenteredStillGroups } from '../../lib/presentation/authoring';
import {
  encodePresentationAssetDragPayload,
  PRESENTATION_ASSET_DRAG_MIME,
  type PresentationAssetDragPayload,
} from '../../lib/presentation/drag';

export interface PresentationAssetBrowserProps {
  schema: TaggingSchema | null;
  manifest: ProjectManifestV1;
  assetIndex: PresentationAssetIndex;
  selectedMarkId: string | null;
  selectedStillId: string | null;
  selectedClipId?: string | null;
  clips?: Clip[];
  mode?: 'authoring' | 'retrieval';
  compact?: boolean;
  onPreviewMark: (mark: ProjectManifestV1['marks'][number]) => void;
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

const badgeCls = "text-[10px] leading-4 px-[5px] rounded-lg bg-subtle text-secondary font-semibold shrink-0";
const chevronCls = "inline-block w-3.5 text-center text-[10px] text-muted shrink-0 transition-transform duration-150 ease-in-out";
const collapsibleOpen = "grid grid-rows-[1fr] overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out";
const collapsibleClosed = "grid grid-rows-[0fr] overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out";

function startAssetDrag(event: React.DragEvent, payload: PresentationAssetDragPayload) {
  event.dataTransfer.setData(PRESENTATION_ASSET_DRAG_MIME, encodePresentationAssetDragPayload(payload));
  event.dataTransfer.effectAllowed = 'copy';
}

function SourceRow({
  label,
  selected,
  payload,
  onClick,
  disabledClick = false,
}: {
  label: string;
  selected?: boolean;
  payload?: PresentationAssetDragPayload;
  onClick?: () => void;
  disabledClick?: boolean;
}) {
  return (
    <button
      data-presentation-asset-kind={payload?.kind}
      data-presentation-asset-id={payload ? ('stillId' in payload ? payload.stillId : 'clipId' in payload ? payload.clipId : payload.markId) : undefined}
      draggable={!!payload}
      onDragStart={payload ? (event) => startAssetDrag(event, payload) : undefined}
      onClick={disabledClick ? undefined : onClick}
      className={`block w-full text-left px-2 py-0.5 m-0 border-0 text-xs font-mono transition-[background,color] duration-[120ms] ease ${
        payload ? 'cursor-grab active:cursor-grabbing' : disabledClick ? 'cursor-default' : 'cursor-pointer'
      } ${selected ? 'text-accent bg-selected' : 'text-secondary bg-transparent hover:bg-hover'}`}
      title={payload ? 'Drag to the deck timeline to add' : undefined}
    >
      <span>{label}</span>
    </button>
  );
}

function FolderHeader({
  label,
  count,
  isOpen,
  onToggle,
  dimmed,
  color,
}: {
  label: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  dimmed?: boolean;
  color?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1 w-full text-left px-1 py-[3px] m-0 cursor-pointer text-sm font-medium border border-transparent transition-[opacity,background,border-color] duration-[120ms] ease ${
        dimmed ? 'opacity-70' : 'opacity-100'
      }`}
      style={{ color: color ?? (dimmed ? '#64748b' : '#e2e8f0') }}
    >
      <span className={chevronCls} style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && <span className={badgeCls}>{count}</span>}
    </button>
  );
}

function MarkAssetRows({
  asset,
  selectedMarkId,
  selectedStillId,
  mode,
  onPreviewMark,
}: {
  asset: PresentationAssetMark;
  selectedMarkId: string | null;
  selectedStillId: string | null;
  mode: 'authoring' | 'retrieval';
  onPreviewMark: (mark: ProjectManifestV1['marks'][number]) => void;
}) {
  const linkedStills = asset.linkedStills.slice().sort((a, b) => a.t_ms - b.t_ms);
  const existingStill = asset.canonicalStill ?? linkedStills[0] ?? null;
  const dragPayload: PresentationAssetDragPayload | undefined = mode !== 'authoring'
    ? undefined
    : existingStill
      ? { kind: 'still', stillId: existingStill.id }
      : { kind: 'mark', markId: asset.mark.id };

  return (
    <div>
      <SourceRow
        label={formatTimestamp(asset.mark.t_ms)}
        selected={selectedMarkId === asset.mark.id || selectedStillId === existingStill?.id}
        payload={dragPayload}
        onClick={() => onPreviewMark(asset.mark)}
      />
    </div>
  );
}

function ChronologicalMarkSection({
  group,
  selectedMarkId,
  selectedStillId,
  mode,
  onPreviewMark,
}: {
  group: ChronologicalMarkGroup;
  selectedMarkId: string | null;
  selectedStillId: string | null;
  mode: 'authoring' | 'retrieval';
  onPreviewMark: (mark: ProjectManifestV1['marks'][number]) => void;
}) {
  const [open, setOpen] = useState(group.marks.length > 0);
  return (
    <div>
      <FolderHeader
        label={group.videoLabel}
        count={group.marks.length}
        isOpen={open}
        onToggle={() => setOpen((prev) => !prev)}
        dimmed={group.marks.length === 0}
      />
      <div className={open ? collapsibleOpen : collapsibleClosed}>
        <div className="min-h-0">
          {group.marks.map((asset) => (
            <div key={asset.mark.id} className="ml-[18px]">
              <MarkAssetRows
                asset={asset}
                selectedMarkId={selectedMarkId}
                selectedStillId={selectedStillId}
                mode={mode}
                onPreviewMark={onPreviewMark}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClipCenteredSection({
  group,
  selectedStillId,
  selectedClipId,
  onPreviewMark,
}: {
  group: ClipCenteredStillGroup;
  selectedStillId: string | null;
  selectedClipId: string | null;
  onPreviewMark: (mark: ProjectManifestV1['marks'][number]) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <FolderHeader
        label={group.clip.id}
        count={group.stills.length}
        isOpen={open}
        onToggle={() => setOpen((prev) => !prev)}
        dimmed={false}
        color={selectedClipId === group.clip.id ? '#e5e7eb' : undefined}
      />
      <div className="ml-[18px]">
        <SourceRow
          label={`${formatTimestamp(group.clip.startMs)} → ${formatTimestamp(group.clip.endMs)}`}
          selected={selectedClipId === group.clip.id}
          payload={{ kind: 'clip', clipId: group.clip.id }}
          disabledClick
        />
      </div>
      <div className={open ? collapsibleOpen : collapsibleClosed}>
        <div className="min-h-0">
          {group.stills.length > 0 ? (
            group.stills.map((entry) => (
              <div key={entry.still.id} className="ml-[18px]">
                <SourceRow
                  label={formatTimestamp(entry.still.t_ms)}
                  selected={selectedStillId === entry.still.id}
                  payload={{ kind: 'still', stillId: entry.still.id }}
                  onClick={entry.sourceMark ? () => onPreviewMark(entry.sourceMark!) : undefined}
                  disabledClick={!entry.sourceMark}
                />
              </div>
            ))
          ) : (
            <div className="ml-[18px] px-2 py-1 text-xs text-muted">No stills inside this clip yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function TreeNodeSection({
  node,
  selectedMarkId,
  selectedStillId,
  mode,
  onPreviewMark,
  depth = 0,
}: {
  node: PresentationAssetTreeNode;
  selectedMarkId: string | null;
  selectedStillId: string | null;
  mode: 'authoring' | 'retrieval';
  onPreviewMark: (mark: ProjectManifestV1['marks'][number]) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(node.markCount > 0);
  return (
    <div style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <FolderHeader
        label={node.label}
        count={node.markCount}
        isOpen={open}
        onToggle={() => setOpen((prev) => !prev)}
        dimmed={node.markCount === 0}
      />
      <div className={open ? collapsibleOpen : collapsibleClosed}>
        <div className="min-h-0">
          {node.marks.map((asset) => (
            <div key={asset.mark.id} className="ml-[18px]">
              <MarkAssetRows
                asset={asset}
                selectedMarkId={selectedMarkId}
                selectedStillId={selectedStillId}
                mode={mode}
                onPreviewMark={onPreviewMark}
              />
            </div>
          ))}
          {node.children.map((child) => (
            <TreeNodeSection
              key={child.id}
              node={child}
              selectedMarkId={selectedMarkId}
              selectedStillId={selectedStillId}
              mode={mode}
              onPreviewMark={onPreviewMark}
              depth={depth + 1}
            />
          ))}
          {node.markCount === 0 && (
            <div className="ml-[18px] px-2 py-1 text-xs text-muted">No marks in this branch.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClipListSection({
  clips,
  selectedClipId,
}: {
  clips: Clip[];
  selectedClipId: string | null;
}) {
  const [open, setOpen] = useState(clips.length > 0);
  return (
    <div>
      <FolderHeader
        label="Clips"
        count={clips.length}
        isOpen={open}
        onToggle={() => setOpen((prev) => !prev)}
        dimmed={clips.length === 0}
      />
      <div className={open ? collapsibleOpen : collapsibleClosed}>
        <div className="min-h-0">
          {clips.map((clip) => (
            <div key={clip.id} className="ml-[18px]">
              <SourceRow
                label={`${formatTimestamp(clip.startMs)} → ${formatTimestamp(clip.endMs)}`}
                selected={selectedClipId === clip.id}
                payload={{ kind: 'clip', clipId: clip.id }}
                disabledClick
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function PresentationAssetBrowser({
  schema,
  manifest,
  assetIndex,
  selectedMarkId,
  selectedStillId,
  selectedClipId = null,
  clips = [],
  mode = 'authoring',
  compact = false,
  onPreviewMark,
}: PresentationAssetBrowserProps) {
  const [viewMode, setViewMode] = useState<'tagged' | 'chronological' | 'clip_centered'>('tagged');
  const [openBuckets, setOpenBuckets] = useState<Set<string>>(() => new Set(['untagged', 'unknown', 'missing']));
  const toggleBucket = (bucket: string) => {
    setOpenBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  };
  const unknownWithLabels = useMemo(() => {
    return assetIndex.unknown.map((asset) => ({
      asset,
      primary: ensureTaggingSelection(asset.mark.tags).primary,
    }));
  }, [assetIndex.unknown]);
  const chronologicalMarkGroups = useMemo(() => buildChronologicalMarkGroups(manifest), [manifest]);
  const clipCenteredGroups = useMemo(() => buildClipCenteredStillGroups(manifest, clips), [manifest, clips]);
  const showChronological = mode === 'authoring' && viewMode === 'chronological';
  const showClipCentered = mode === 'authoring' && viewMode === 'clip_centered';

  return (
    <div className={`${compact ? 'w-[320px]' : 'w-[360px] shrink-0 border-r'} min-h-0 border-subtle bg-surface flex flex-col overflow-hidden`}>
      <div className="shrink-0 px-3 py-2 border-b border-subtle">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-wide text-muted">{mode === 'retrieval' ? 'Mark retrieval' : 'Sources'}</div>
          {mode === 'authoring' && (
            <div className="text-[11px] text-muted">
              {manifest.marks.length} marks · {manifest.stills.length} stills · {clips.length} clips
            </div>
          )}
        </div>
        <div className="text-[11px] text-muted mt-1">
          {mode === 'retrieval' ? 'Click a mark to retrieve video.' : 'Click to seek marks. Drag sources to the deck.'}
        </div>
      </div>

      {mode === 'authoring' && (
        <div className="shrink-0 flex items-center gap-1 px-2 py-2 border-b border-subtle">
          <span className="text-xs uppercase tracking-wide text-muted px-1">Browse</span>
          {([
            ['tagged', 'Tags'],
            ['chronological', 'Time'],
            ['clip_centered', 'Clips'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setViewMode(id)}
              className={`px-2 py-1 text-xs border-0 ${viewMode === id ? 'bg-selected text-accent' : 'bg-transparent text-secondary hover:bg-hover'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2 text-sm">
        {mode === 'authoring' && clips.length > 0 && !showClipCentered && (
          <div className="mb-2 border-b border-subtle pb-2">
            <ClipListSection clips={clips} selectedClipId={selectedClipId} />
          </div>
        )}

        {showChronological ? (
          chronologicalMarkGroups.length > 0 ? (
            chronologicalMarkGroups.map((group) => (
              <ChronologicalMarkSection
                key={group.videoId}
                group={group}
                selectedMarkId={selectedMarkId}
                selectedStillId={selectedStillId}
                mode={mode}
                onPreviewMark={onPreviewMark}
              />
            ))
          ) : (
            <div className="px-2 py-1 text-sm text-muted">No marks available yet.</div>
          )
        ) : showClipCentered ? (
          clipCenteredGroups.length > 0 ? (
            clipCenteredGroups.map((group) => (
              <ClipCenteredSection
                key={group.clip.id}
                group={group}
                selectedStillId={selectedStillId}
                selectedClipId={selectedClipId}
                onPreviewMark={onPreviewMark}
              />
            ))
          ) : (
            <div className="px-2 py-1 text-sm text-muted">No clips available yet.</div>
          )
        ) : (
          <>
            <div className="border-b border-subtle pb-2">
              <FolderHeader
                label="Untagged"
                count={assetIndex.untagged.length}
                isOpen={openBuckets.has('untagged')}
                onToggle={() => toggleBucket('untagged')}
                dimmed={assetIndex.untagged.length === 0}
              />
              <div className={openBuckets.has('untagged') ? collapsibleOpen : collapsibleClosed}>
                <div className="min-h-0">
                  {assetIndex.untagged.length > 0 ? (
                    assetIndex.untagged.map((asset) => (
                      <div key={asset.mark.id} className="ml-[18px]">
                        <MarkAssetRows
                          asset={asset}
                          selectedMarkId={selectedMarkId}
                          selectedStillId={selectedStillId}
                          mode={mode}
                          onPreviewMark={onPreviewMark}
                        />
                      </div>
                    ))
                  ) : (
                    <div className="ml-[18px] px-2 py-1 text-xs text-muted">No untagged marks.</div>
                  )}
                </div>
              </div>
            </div>

            {schema ? (
              <div className="py-2">
                {assetIndex.tree.map((node) => (
                  <TreeNodeSection
                    key={node.id}
                    node={node}
                    selectedMarkId={selectedMarkId}
                    selectedStillId={selectedStillId}
                    mode={mode}
                    onPreviewMark={onPreviewMark}
                  />
                ))}
              </div>
            ) : (
              <div className="px-2 py-2 text-sm text-muted">No tagging schema loaded. Only repair buckets are available.</div>
            )}

            <div className="border-t border-subtle pt-2">
              <FolderHeader
                label="Unknown tag"
                count={unknownWithLabels.length}
                isOpen={openBuckets.has('unknown')}
                onToggle={() => toggleBucket('unknown')}
                dimmed={unknownWithLabels.length === 0}
                color={unknownWithLabels.length > 0 ? '#f59e0b' : undefined}
              />
              <div className={openBuckets.has('unknown') ? collapsibleOpen : collapsibleClosed}>
                <div className="min-h-0">
                  {unknownWithLabels.length > 0 ? (
                    unknownWithLabels.map(({ asset, primary }) => (
                      <div key={asset.mark.id} className="ml-[18px]">
                        <MarkAssetRows
                          asset={asset}
                          selectedMarkId={selectedMarkId}
                          selectedStillId={selectedStillId}
                          mode={mode}
                          onPreviewMark={onPreviewMark}
                        />
                        {primary && <div className="px-2 pb-1 text-[11px] text-warning">Unknown primary tag: {primary}</div>}
                      </div>
                    ))
                  ) : (
                    <div className="ml-[18px] px-2 py-1 text-xs text-muted">No marks with unknown tags.</div>
                  )}
                </div>
              </div>
            </div>

            {mode === 'authoring' && (
              <div className="border-t border-subtle mt-2 pt-2">
                <FolderHeader
                  label="Missing source mark"
                  count={assetIndex.missingSourceMark.length}
                  isOpen={openBuckets.has('missing')}
                  onToggle={() => toggleBucket('missing')}
                  dimmed={assetIndex.missingSourceMark.length === 0}
                />
                <div className={openBuckets.has('missing') ? collapsibleOpen : collapsibleClosed}>
                  <div className="min-h-0">
                    {assetIndex.missingSourceMark.length > 0 ? (
                      assetIndex.missingSourceMark.map((still) => (
                        <div key={still.id} className="ml-[18px]">
                          <SourceRow
                            label={formatTimestamp(still.t_ms)}
                            selected={selectedStillId === still.id}
                            payload={{ kind: 'still', stillId: still.id }}
                            disabledClick
                          />
                        </div>
                      ))
                    ) : (
                      <div className="ml-[18px] px-2 py-1 text-xs text-muted">No missing-source-mark stills.</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
