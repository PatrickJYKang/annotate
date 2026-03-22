"use client";

import { useMemo, useState } from 'react';
import type { Clip } from '../../lib/types/clip';
import type { ProjectManifestV1 } from '../../lib/types/project';
import type { TaggingSchema } from '../../lib/tagging/schema';
import { ensureTaggingSelection } from '../../lib/tagging/schema';
import type {
  PresentationAssetIndex,
  PresentationAssetMark,
  PresentationAssetTreeNode,
} from '../../lib/presentation/authoring';

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
  onInsertStill?: (stillId: string) => void;
  onInsertClip?: (clipId: string) => void;
  onCreateStillForMark?: (mark: ProjectManifestV1['marks'][number]) => void;
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

function MarkAssetRow({
  asset,
  selectedMarkId,
  selectedStillId,
  mode,
  onPreviewMark,
  onInsertStill,
  onCreateStillForMark,
}: {
  asset: PresentationAssetMark;
  selectedMarkId: string | null;
  selectedStillId: string | null;
  mode: 'authoring' | 'retrieval';
  onPreviewMark: (mark: ProjectManifestV1['marks'][number]) => void;
  onInsertStill?: (stillId: string) => void;
  onCreateStillForMark?: (mark: ProjectManifestV1['marks'][number]) => void;
}) {
  const selection = ensureTaggingSelection(asset.mark.tags);
  return (
    <div className="border-t border-subtle first:border-t-0">
      <button
        onClick={() => onPreviewMark(asset.mark)}
        className={`w-full text-left px-3 py-2 ${selectedMarkId === asset.mark.id ? 'bg-selected' : 'bg-transparent hover:bg-hover'}`}
      >
        <div className="text-sm font-medium">{formatTimestamp(asset.mark.t_ms)}</div>
        <div className="text-xs text-muted mt-1">
          {selection.primary || 'Untagged'} · {asset.linkedStills.length} linked stills
        </div>
      </button>
      {mode === 'authoring' && (
        <div className="px-3 pb-3 flex flex-col gap-2">
        {asset.linkedStills.length > 0 ? (
          asset.linkedStills
            .slice()
            .sort((a, b) => a.t_ms - b.t_ms)
            .map((still) => {
              const isCanonical = asset.canonicalStill?.id === still.id;
              return (
                <div key={still.id} className={`rounded border px-2 py-2 ${selectedStillId === still.id ? 'border-accent bg-selected' : 'border-subtle bg-canvas'}`}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{still.id}</div>
                      <div className="text-[11px] text-muted mt-1">
                        {formatTimestamp(still.t_ms)}{isCanonical ? ' · canonical' : ''}
                      </div>
                    </div>
                    {onInsertStill && <button onClick={() => onInsertStill(still.id)} className="px-2 py-1 text-xs cursor-pointer">Add</button>}
                  </div>
                </div>
              );
            })
        ) : (
          <div className="rounded border border-dashed border-subtle px-3 py-2 text-xs text-muted flex items-center gap-2">
            <span className="flex-1">No linked still yet for this mark.</span>
            {onCreateStillForMark && <button onClick={() => onCreateStillForMark(asset.mark)} className="px-2 py-1 text-xs cursor-pointer">Create still + add</button>}
          </div>
        )}
        </div>
      )}
    </div>
  );
}

function TreeNodeSection({
  node,
  selectedMarkId,
  selectedStillId,
  mode,
  onPreviewMark,
  onInsertStill,
  onCreateStillForMark,
}: {
  node: PresentationAssetTreeNode;
  selectedMarkId: string | null;
  selectedStillId: string | null;
  mode: 'authoring' | 'retrieval';
  onPreviewMark: (mark: ProjectManifestV1['marks'][number]) => void;
  onInsertStill?: (stillId: string) => void;
  onCreateStillForMark?: (mark: ProjectManifestV1['marks'][number]) => void;
}) {
  const [open, setOpen] = useState(node.markCount > 0);
  return (
    <div className="border border-subtle rounded overflow-hidden">
      <button onClick={() => setOpen((prev) => !prev)} className="w-full text-left px-3 py-2 bg-canvas flex items-center gap-2">
        <span className="text-xs text-muted">{open ? '▾' : '▸'}</span>
        <span className="flex-1 text-sm font-medium">{node.label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-subtle text-secondary">{node.markCount}</span>
      </button>
      {open && (
        <div>
          {node.marks.map((asset) => (
            <MarkAssetRow
              key={asset.mark.id}
              asset={asset}
              selectedMarkId={selectedMarkId}
              selectedStillId={selectedStillId}
              mode={mode}
              onPreviewMark={onPreviewMark}
              onInsertStill={onInsertStill}
              onCreateStillForMark={onCreateStillForMark}
            />
          ))}
          {node.children.length > 0 && (
            <div className="px-2 py-2 flex flex-col gap-2 bg-surface">
              {node.children.map((child) => (
                <TreeNodeSection
                  key={child.id}
                  node={child}
                  selectedMarkId={selectedMarkId}
                  selectedStillId={selectedStillId}
                  mode={mode}
                  onPreviewMark={onPreviewMark}
                  onInsertStill={onInsertStill}
                  onCreateStillForMark={onCreateStillForMark}
                />
              ))}
            </div>
          )}
          {node.markCount === 0 && (
            <div className="px-3 py-2 text-xs text-muted">No marks in this branch.</div>
          )}
        </div>
      )}
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
  onInsertStill,
  onInsertClip,
  onCreateStillForMark,
}: PresentationAssetBrowserProps) {
  const unknownWithLabels = useMemo(() => {
    return assetIndex.unknown.map((asset) => ({
      asset,
      primary: ensureTaggingSelection(asset.mark.tags).primary,
    }));
  }, [assetIndex.unknown]);

  return (
    <div className={`${compact ? 'w-[320px]' : 'w-[360px] shrink-0 border-r'} border-subtle bg-surface p-4 overflow-y-auto flex flex-col gap-4`}>
      <div>
        <div className="text-xs uppercase tracking-wide text-muted">{mode === 'retrieval' ? 'Mark retrieval' : 'Asset browser'}</div>
        <div className="text-sm text-muted mt-2">
          {mode === 'retrieval'
            ? 'Compact mark browser for ad hoc retrieval during presenting.'
            : 'Mark-first browser with linked still insertion and repair buckets.'}
        </div>
      </div>

      {!compact && (
        <div className="border border-subtle rounded p-3">
          <div className="text-xs uppercase tracking-wide text-muted">Project context</div>
          <div className="text-sm mt-2">{manifest.name}</div>
          <div className="text-sm text-muted mt-1">{manifest.videos.length} videos · {manifest.marks.length} marks · {manifest.stills.length} stills · {clips.length} clips</div>
          <div className="text-sm text-muted mt-1">Tagging schema: {schema ? `v${schema.version}` : 'missing'}</div>
        </div>
      )}

      {mode === 'authoring' && clips.length > 0 && (
        <div className="border border-subtle rounded overflow-hidden">
          <div className="px-3 py-2 bg-canvas text-sm font-medium">Clips</div>
          {clips.map((clip) => (
            <div key={clip.id} className={`px-3 py-2 border-t border-subtle first:border-t-0 ${selectedClipId === clip.id ? 'bg-selected' : 'bg-transparent'}`}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{clip.id}</div>
                  <div className="text-[11px] text-muted mt-1">{clip.videoId} · {formatTimestamp(clip.startMs)} → {formatTimestamp(clip.endMs)}</div>
                </div>
                {onInsertClip && <button onClick={() => onInsertClip(clip.id)} className="px-2 py-1 text-xs cursor-pointer">Add</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border border-subtle rounded overflow-hidden">
        <div className="px-3 py-2 bg-canvas text-sm font-medium">Untagged</div>
        {assetIndex.untagged.length > 0 ? (
          assetIndex.untagged.map((asset) => (
            <MarkAssetRow
              key={asset.mark.id}
              asset={asset}
              selectedMarkId={selectedMarkId}
              selectedStillId={selectedStillId}
              mode={mode}
              onPreviewMark={onPreviewMark}
              onInsertStill={onInsertStill}
              onCreateStillForMark={onCreateStillForMark}
            />
          ))
        ) : (
          <div className="px-3 py-2 text-xs text-muted">No untagged marks.</div>
        )}
      </div>

      {schema ? (
        <div className="flex flex-col gap-3">
          {assetIndex.tree.map((node) => (
            <TreeNodeSection
              key={node.id}
              node={node}
              selectedMarkId={selectedMarkId}
              selectedStillId={selectedStillId}
              mode={mode}
              onPreviewMark={onPreviewMark}
              onInsertStill={onInsertStill}
              onCreateStillForMark={onCreateStillForMark}
            />
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted">No tagging schema loaded. Only repair buckets are available.</div>
      )}

      <div className="border border-subtle rounded overflow-hidden">
        <div className="px-3 py-2 bg-canvas text-sm font-medium">Unknown tag</div>
        {unknownWithLabels.length > 0 ? (
          unknownWithLabels.map(({ asset, primary }) => (
            <div key={asset.mark.id}>
              <MarkAssetRow
                asset={asset}
                selectedMarkId={selectedMarkId}
                selectedStillId={selectedStillId}
                mode={mode}
                onPreviewMark={onPreviewMark}
                onInsertStill={onInsertStill}
                onCreateStillForMark={onCreateStillForMark}
              />
              {primary && <div className="px-3 pb-3 text-[11px] text-warning">Unknown primary tag: {primary}</div>}
            </div>
          ))
        ) : (
          <div className="px-3 py-2 text-xs text-muted">No marks with unknown tags.</div>
        )}
      </div>

      {mode === 'authoring' && (
        <div className="border border-subtle rounded overflow-hidden">
          <div className="px-3 py-2 bg-canvas text-sm font-medium">Missing source mark</div>
          {assetIndex.missingSourceMark.length > 0 ? (
            assetIndex.missingSourceMark.map((still) => (
              <div key={still.id} className="px-3 py-2 border-t border-subtle first:border-t-0">
                <div className="text-sm font-medium">{still.id}</div>
                <div className="text-xs text-muted mt-1">
                  {still.videoId} · {formatTimestamp(still.t_ms)} · {still.sourceMarkId || 'unresolved'}
                </div>
              </div>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-muted">No missing-source-mark stills.</div>
          )}
        </div>
      )}
    </div>
  );
}
