"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TaggingSchema, TaggingNode, TaggingSelection } from "../../lib/tagging/schema";
import { ensureTaggingSelection } from "../../lib/tagging/schema";

type Mark = {
  id: string;
  videoId: string;
  t_ms: number;
  tags?: TaggingSelection | string[];
};

export type TagFolderTreeProps = {
  schema: TaggingSchema;
  marks: Mark[];
  selectedMarkId: string | null;
  onSelectMark: (markId: string) => void;
  onContextMenu: (markId: string, event: React.MouseEvent) => void;
  onDropMarkOnNode?: (markId: string, nodeId: string) => void;
  formatTimestamp?: (ms: number) => string;
};

// --- helpers ---

function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function pad3(n: number) { return n.toString().padStart(3, "0"); }

function formatTime(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms || 0));
  let r = clamped;
  const hh = Math.floor(r / 3600000); r %= 3600000;
  const mm = Math.floor(r / 60000); r %= 60000;
  const ss = Math.floor(r / 1000); const mmm = r % 1000;
  return hh > 0 ? `${hh}:${pad2(mm)}:${pad2(ss)}.${pad3(mmm)}` : `${mm}:${pad2(ss)}.${pad3(mmm)}`;
}

function collectNodeIds(nodes: TaggingNode[], out: Set<string>): void {
  for (const node of nodes) {
    out.add(node.id);
    if (node.children) collectNodeIds(node.children, out);
  }
}

type MarksByNode = Map<string, Mark[]>;

function buildMarkIndex(
  marks: Mark[],
  allNodeIds: Set<string>,
): { byNode: MarksByNode; untagged: Mark[]; unknown: Mark[] } {
  const byNode: MarksByNode = new Map();
  const untagged: Mark[] = [];
  const unknown: Mark[] = [];

  for (const mark of marks) {
    const sel = ensureTaggingSelection(mark.tags);
    const primary = sel.primary;
    if (!primary) {
      untagged.push(mark);
    } else if (allNodeIds.has(primary)) {
      const existing = byNode.get(primary);
      if (existing) existing.push(mark);
      else byNode.set(primary, [mark]);
    } else {
      unknown.push(mark);
    }
  }

  return { byNode, untagged, unknown };
}

function countMarksInNode(nodeId: string, children: TaggingNode[] | undefined, byNode: MarksByNode): number {
  let count = (byNode.get(nodeId) || []).length;
  if (children) {
    for (const child of children) {
      count += countMarksInNode(child.id, child.children, byNode);
    }
  }
  return count;
}

function collectNonEmptyNodeIds(nodes: TaggingNode[], byNode: MarksByNode, out: Set<string>): void {
  for (const node of nodes) {
    const count = countMarksInNode(node.id, node.children, byNode);
    if (count > 0) {
      out.add(node.id);
    }
    if (node.children) {
      collectNonEmptyNodeIds(node.children, byNode, out);
    }
  }
}

// --- styles ---

const badgeCls = "text-[10px] leading-4 px-[5px] rounded-lg bg-subtle text-secondary font-semibold shrink-0";
const chevronCls = "inline-block w-3.5 text-center text-[10px] text-muted shrink-0 transition-transform duration-150 ease-in-out";
const collapsibleOpen = "grid grid-rows-[1fr] overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out";
const collapsibleClosed = "grid grid-rows-[0fr] overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out";

// --- sub-components ---

const DRAG_MIME = "application/x-mark-id";

function MarkItem({
  mark,
  isSelected,
  onSelect,
  onContextMenu,
  label,
  formatTimestamp,
}: {
  mark: Mark;
  isSelected: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  label?: string;
  formatTimestamp?: (ms: number) => string;
}) {
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, mark.id);
    e.dataTransfer.effectAllowed = "move";
  }, [mark.id]);

  return (
    <button
      data-mark-id={mark.id}
      draggable
      onDragStart={handleDragStart}
      onClick={onSelect}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e); }}
      className={`block w-full text-left px-2 py-0.5 m-0 border-0 cursor-grab text-xs font-mono transition-[background,color] duration-[120ms] ease ${
        isSelected ? 'text-accent bg-selected' : 'text-secondary bg-transparent'
      }`}
    >
      {(formatTimestamp ?? formatTime)(mark.t_ms)}
      {label && <span className="ml-1.5 text-[10px] text-muted">{label}</span>}
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
  nodeId,
  onDropMarkOnNode,
}: {
  label: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  dimmed?: boolean;
  color?: string;
  nodeId?: string;
  onDropMarkOnNode?: (markId: string, nodeId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const canDrop = !!nodeId && !!onDropMarkOnNode;

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!canDrop) return;
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }, [canDrop]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!canDrop) return;
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      setDragOver(true);
    }
  }, [canDrop]);

  const handleDragLeave = useCallback(() => { setDragOver(false); }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    setDragOver(false);
    if (!canDrop || !nodeId || !onDropMarkOnNode) return;
    const markId = e.dataTransfer.getData(DRAG_MIME);
    if (markId) {
      e.preventDefault();
      onDropMarkOnNode(markId, nodeId);
    }
  }, [canDrop, nodeId, onDropMarkOnNode]);

  return (
    <button
      onClick={onToggle}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex items-center gap-1 w-full text-left px-1 py-[3px] m-0 cursor-pointer text-sm font-medium transition-[opacity,background,border-color] duration-[120ms] ease ${
        dimmed ? 'opacity-70' : 'opacity-100'
      }`}
      style={{
        border: dragOver ? '1px dashed #60a5fa' : '1px solid transparent',
        color: color ?? (dimmed ? '#475569' : '#e2e8f0'),
        background: dragOver ? 'rgba(96, 165, 250, 0.1)' : 'transparent',
      }}
    >
      <span className={chevronCls} style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
        ▾
      </span>
      <span className="flex-1">{label}</span>
      {count > 0 && <span className={badgeCls}>{count}</span>}
    </button>
  );
}

function FolderNode({
  node,
  depth,
  byNode,
  selectedMarkId,
  onSelectMark,
  onContextMenu,
  expanded,
  onToggle,
  onDropMarkOnNode,
  formatTimestamp,
}: {
  node: TaggingNode;
  depth: number;
  byNode: MarksByNode;
  selectedMarkId: string | null;
  onSelectMark: (id: string) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onDropMarkOnNode?: (markId: string, nodeId: string) => void;
  formatTimestamp?: (ms: number) => string;
}) {
  const count = useMemo(
    () => countMarksInNode(node.id, node.children, byNode),
    [node.id, node.children, byNode],
  );
  const directMarks = byNode.get(node.id) || [];
  const isOpen = expanded.has(node.id);

  return (
    <div style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <FolderHeader
        label={node.label}
        count={count}
        isOpen={isOpen}
        onToggle={() => onToggle(node.id)}
        dimmed={count === 0}
        nodeId={node.id}
        onDropMarkOnNode={onDropMarkOnNode}
      />

      <div className={isOpen ? collapsibleOpen : collapsibleClosed}>
        <div className="min-h-0">
          {directMarks
            .slice()
            .sort((a, b) => a.t_ms - b.t_ms)
            .map((mark) => (
              <div key={mark.id} className="ml-[18px]">
                <MarkItem
                  mark={mark}
                  isSelected={mark.id === selectedMarkId}
                  onSelect={() => onSelectMark(mark.id)}
                  onContextMenu={(e) => onContextMenu(mark.id, e)}
                  formatTimestamp={formatTimestamp}
                />
              </div>
            ))}

          {node.children?.map((child) => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              byNode={byNode}
              selectedMarkId={selectedMarkId}
              onSelectMark={onSelectMark}
              onContextMenu={onContextMenu}
              expanded={expanded}
              onToggle={onToggle}
              onDropMarkOnNode={onDropMarkOnNode}
              formatTimestamp={formatTimestamp}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// --- main component ---

export default function TagFolderTree({
  schema,
  marks,
  selectedMarkId,
  onSelectMark,
  onContextMenu,
  onDropMarkOnNode,
  formatTimestamp,
}: TagFolderTreeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const initializedRef = useRef(false);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allNodeIds = useMemo(() => {
    const ids = new Set<string>();
    collectNodeIds(schema.primary_tree, ids);
    return ids;
  }, [schema]);

  const { byNode, untagged, unknown } = useMemo(
    () => buildMarkIndex(marks, allNodeIds),
    [marks, allNodeIds],
  );

  // Auto-expand folders that have marks; always show Untagged & Unknown
  useEffect(() => {
    const nonEmpty = new Set<string>();
    collectNonEmptyNodeIds(schema.primary_tree, byNode, nonEmpty);
    if (untagged.length > 0) nonEmpty.add("__untagged");
    if (unknown.length > 0) nonEmpty.add("__unknown");

    if (!initializedRef.current) {
      // First render: set expanded to exactly the non-empty set
      setExpanded(nonEmpty);
      initializedRef.current = true;
    } else {
      // Subsequent updates: expand newly non-empty folders (don't collapse user-opened ones)
      setExpanded((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const id of nonEmpty) {
          if (!next.has(id)) { next.add(id); changed = true; }
        }
        return changed ? next : prev;
      });
    }
  }, [schema, byNode, untagged.length, unknown.length]);

  useEffect(() => {
    if (!selectedMarkId || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-mark-id="${CSS.escape(selectedMarkId)}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedMarkId]);

  return (
    <div ref={containerRef} className="overflow-y-auto px-1 py-2 text-sm">
      {/* Schema-derived folders */}
      {schema.primary_tree.map((node) => (
        <FolderNode
          key={node.id}
          node={node}
          depth={0}
          byNode={byNode}
          selectedMarkId={selectedMarkId}
          onSelectMark={onSelectMark}
          onContextMenu={onContextMenu}
          expanded={expanded}
          onToggle={toggle}
          onDropMarkOnNode={onDropMarkOnNode}
          formatTimestamp={formatTimestamp}
        />
      ))}

      {/* Untagged bucket */}
      <div className="mt-2 border-t border-subtle pt-2">
        <FolderHeader
          label="Untagged"
          count={untagged.length}
          isOpen={expanded.has("__untagged")}
          onToggle={() => toggle("__untagged")}
          dimmed={untagged.length === 0}
        />
        <div className={expanded.has("__untagged") ? collapsibleOpen : collapsibleClosed}>
          <div className="min-h-0">
            {untagged
              .slice()
              .sort((a, b) => a.t_ms - b.t_ms)
              .map((mark) => (
                <div key={mark.id} className="ml-[18px]">
                  <MarkItem
                    mark={mark}
                    isSelected={mark.id === selectedMarkId}
                    onSelect={() => onSelectMark(mark.id)}
                    onContextMenu={(e) => onContextMenu(mark.id, e)}
                    formatTimestamp={formatTimestamp}
                  />
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Unknown tag bucket */}
      {unknown.length > 0 && (
        <div className="mt-1">
          <FolderHeader
            label="Unknown tag"
            count={unknown.length}
            isOpen={expanded.has("__unknown")}
            onToggle={() => toggle("__unknown")}
            color="#f59e0b"
          />
          <div className={expanded.has("__unknown") ? collapsibleOpen : collapsibleClosed}>
            <div className="min-h-0">
              {unknown
                .slice()
                .sort((a, b) => a.t_ms - b.t_ms)
                .map((mark) => {
                  const primary = ensureTaggingSelection(mark.tags).primary;
                  return (
                    <div key={mark.id} className="ml-[18px]">
                      <MarkItem
                        mark={mark}
                        isSelected={mark.id === selectedMarkId}
                        onSelect={() => onSelectMark(mark.id)}
                        onContextMenu={(e) => onContextMenu(mark.id, e)}
                        label={primary ? `[${primary}]` : undefined}
                        formatTimestamp={formatTimestamp}
                      />
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
