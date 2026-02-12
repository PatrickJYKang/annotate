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

const BADGE_STYLE: React.CSSProperties = {
  fontSize: 10,
  lineHeight: "16px",
  padding: "0 5px",
  borderRadius: 8,
  background: "#1e293b",
  color: "#94a3b8",
  fontWeight: 600,
  flexShrink: 0,
};

const CHEVRON_STYLE: React.CSSProperties = {
  display: "inline-block",
  width: 14,
  textAlign: "center",
  fontSize: 10,
  color: "#64748b",
  flexShrink: 0,
  transition: "transform 150ms ease",
};

const COLLAPSIBLE_STYLE_OPEN: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "1fr",
  overflow: "hidden",
  transition: "grid-template-rows 200ms ease",
};

const COLLAPSIBLE_STYLE_CLOSED: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "0fr",
  overflow: "hidden",
  transition: "grid-template-rows 200ms ease",
};

// --- sub-components ---

const DRAG_MIME = "application/x-mark-id";

function MarkItem({
  mark,
  isSelected,
  onSelect,
  onContextMenu,
  label,
}: {
  mark: Mark;
  isSelected: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  label?: string;
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
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "2px 8px",
        margin: 0,
        border: "none",
        borderRadius: 3,
        cursor: "grab",
        fontSize: 12,
        fontFamily: "monospace",
        color: isSelected ? "#e2e8f0" : "#94a3b8",
        background: isSelected ? "#334155" : "transparent",
        transition: "background 120ms ease, color 120ms ease",
      }}
    >
      {formatTime(mark.t_ms)}
      {label && <span style={{ marginLeft: 6, fontSize: 10, color: "#64748b" }}>{label}</span>}
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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        width: "100%",
        textAlign: "left",
        padding: "3px 4px",
        margin: 0,
        border: dragOver ? "1px dashed #60a5fa" : "1px solid transparent",
        borderRadius: 3,
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
        color: color ?? (dimmed ? "#475569" : "#e2e8f0"),
        background: dragOver ? "rgba(96, 165, 250, 0.1)" : "transparent",
        opacity: dimmed ? 0.7 : 1,
        transition: "opacity 150ms ease, background 120ms ease, border-color 120ms ease",
      }}
    >
      <span style={{ ...CHEVRON_STYLE, transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}>
        ▾
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {count > 0 && <span style={BADGE_STYLE}>{count}</span>}
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

      <div style={isOpen ? COLLAPSIBLE_STYLE_OPEN : COLLAPSIBLE_STYLE_CLOSED}>
        <div style={{ minHeight: 0 }}>
          {directMarks
            .slice()
            .sort((a, b) => a.t_ms - b.t_ms)
            .map((mark) => (
              <div key={mark.id} style={{ marginLeft: 18 }}>
                <MarkItem
                  mark={mark}
                  isSelected={mark.id === selectedMarkId}
                  onSelect={() => onSelectMark(mark.id)}
                  onContextMenu={(e) => onContextMenu(mark.id, e)}
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
    <div ref={containerRef} style={{ overflowY: "auto", padding: "8px 4px", fontSize: 13 }}>
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
        />
      ))}

      {/* Untagged bucket */}
      <div style={{ marginTop: 8, borderTop: "1px solid #1e293b", paddingTop: 8 }}>
        <FolderHeader
          label="Untagged"
          count={untagged.length}
          isOpen={expanded.has("__untagged")}
          onToggle={() => toggle("__untagged")}
          dimmed={untagged.length === 0}
        />
        <div style={expanded.has("__untagged") ? COLLAPSIBLE_STYLE_OPEN : COLLAPSIBLE_STYLE_CLOSED}>
          <div style={{ minHeight: 0 }}>
            {untagged
              .slice()
              .sort((a, b) => a.t_ms - b.t_ms)
              .map((mark) => (
                <div key={mark.id} style={{ marginLeft: 18 }}>
                  <MarkItem
                    mark={mark}
                    isSelected={mark.id === selectedMarkId}
                    onSelect={() => onSelectMark(mark.id)}
                    onContextMenu={(e) => onContextMenu(mark.id, e)}
                  />
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Unknown tag bucket */}
      {unknown.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <FolderHeader
            label="Unknown tag"
            count={unknown.length}
            isOpen={expanded.has("__unknown")}
            onToggle={() => toggle("__unknown")}
            color="#f59e0b"
          />
          <div style={expanded.has("__unknown") ? COLLAPSIBLE_STYLE_OPEN : COLLAPSIBLE_STYLE_CLOSED}>
            <div style={{ minHeight: 0 }}>
              {unknown
                .slice()
                .sort((a, b) => a.t_ms - b.t_ms)
                .map((mark) => {
                  const primary = ensureTaggingSelection(mark.tags).primary;
                  return (
                    <div key={mark.id} style={{ marginLeft: 18 }}>
                      <MarkItem
                        mark={mark}
                        isSelected={mark.id === selectedMarkId}
                        onSelect={() => onSelectMark(mark.id)}
                        onContextMenu={(e) => onContextMenu(mark.id, e)}
                        label={primary ? `[${primary}]` : undefined}
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
