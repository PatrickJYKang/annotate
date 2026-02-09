"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createEmptyTaggingSelection,
  ensureTaggingSelection,
  fetchTaggingSchema,
  TaggingFacetGroup,
  TaggingNode,
  TaggingSchema,
  TaggingSelection,
} from "../../lib/tagging/schema";
// fetchTaggingSchema is kept only as a legacy fallback when no schema prop is provided.

export type TaggingMenuCloseReason = "confirm" | "dismiss";

type FacetSelections = TaggingSelection["facets"];

type LevelOption = {
  depth: number;
  options: TaggingNode[];
};

type PathInfo = {
  ids: string[];
  labels: string[];
};

type TaggingMenuProps = {
  open: boolean;
  schema?: TaggingSchema | null;
  selection: TaggingSelection | string[] | null | undefined;
  onSelectionChange: (selection: TaggingSelection) => void;
  onClose: (selection: TaggingSelection, reason: TaggingMenuCloseReason) => void;
  onClear?: () => void;
  anchorPoint?: { x: number; y: number } | null;
  menuStyle?: React.CSSProperties;
};

const EMPTY_SELECTION = createEmptyTaggingSelection();

export default function TaggingMenu({
  open,
  schema: schemaProp,
  selection,
  onSelectionChange,
  onClose,
  onClear,
  anchorPoint,
  menuStyle,
}: TaggingMenuProps) {
  const [schemaFetched, setSchemaFetched] = useState<TaggingSchema | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const schema = schemaProp ?? schemaFetched;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<TaggingSelection>(ensureTaggingSelection(selection));
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    selectionRef.current = ensureTaggingSelection(selection);
  }, [selection]);

  useEffect(() => {
    if (schemaProp || schemaFetched || schemaError) return;
    let active = true;
    fetchTaggingSchema()
      .then((data) => {
        if (!active) return;
        setSchemaFetched(data);
      })
      .catch((err) => {
        if (!active) return;
        setSchemaError(err instanceof Error ? err.message : "Failed to load tagging schema");
      });

    return () => {
      active = false;
    };
  }, [schemaProp, schemaFetched, schemaError]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(selectionRef.current, "dismiss");
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onClose(selectionRef.current, "confirm");
      }
    };
    const handleClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose(selectionRef.current, "dismiss");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClick);
    };
  }, [open, onClose]);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const padding = 12;
      const fallbackWidth = 480;
      const fallbackHeight = 360;
      const anchorX = anchorPoint?.x ?? 120;
      const anchorY = anchorPoint?.y ?? 120;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const rect = menuRef.current?.getBoundingClientRect();
      const width = Math.min(rect?.width ?? fallbackWidth, Math.max(0, viewportWidth - padding * 2));
      const height = Math.min(rect?.height ?? fallbackHeight, Math.max(0, viewportHeight - padding * 2));
      let left = anchorX;
      let top = anchorY;

      if (left + width + padding > viewportWidth) {
        left = Math.max(padding, viewportWidth - width - padding);
      }
      if (top + height + padding > viewportHeight) {
        top = Math.max(padding, viewportHeight - height - padding);
      }
      if (left < padding) left = padding;
      if (top < padding) top = padding;

      setMenuPosition({ left, top });
    };

    const frame = window.requestAnimationFrame(updatePosition);
    const observer = menuRef.current ? new ResizeObserver(updatePosition) : null;
    if (menuRef.current && observer) {
      observer.observe(menuRef.current);
    }
    window.addEventListener("resize", updatePosition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      observer?.disconnect();
    };
  }, [open, anchorPoint]);

  const currentSelection = ensureTaggingSelection(selection ?? EMPTY_SELECTION);
  const primaryId = currentSelection.primary ?? "";
  const facetSelections: FacetSelections = currentSelection.facets ?? {};

  const facetGroupMap = useMemo(() => {
    if (!schema) return new Map<string, TaggingFacetGroup>();
    return new Map(schema.facet_groups.map((group) => [group.id, group]));
  }, [schema]);

  const nodeById = useMemo(() => {
    if (!schema) return new Map<string, TaggingNode>();
    const map = new Map<string, TaggingNode>();
    const walk = (nodes: TaggingNode[]) => {
      nodes.forEach((node) => {
        map.set(node.id, node);
        if (node.children?.length) {
          walk(node.children);
        }
      });
    };
    walk(schema.primary_tree);
    return map;
  }, [schema]);

  const pathIndex = useMemo(() => {
    if (!schema) return new Map<string, PathInfo>();
    const map = new Map<string, PathInfo>();
    const walk = (nodes: TaggingNode[], ancestors: TaggingNode[]) => {
      nodes.forEach((node) => {
        const next = [...ancestors, node];
        map.set(node.id, {
          ids: next.map((entry) => entry.id),
          labels: next.map((entry) => entry.label),
        });
        if (node.children?.length) {
          walk(node.children, next);
        }
      });
    };
    walk(schema.primary_tree, []);
    return map;
  }, [schema]);

  const pathIds = useMemo(() => {
    if (!primaryId) return [];
    return pathIndex.get(primaryId)?.ids ?? [];
  }, [pathIndex, primaryId]);

  const levelOptions = useMemo<LevelOption[]>(() => {
    if (!schema) return [];
    const levels: LevelOption[] = [];
    let current = schema.primary_tree;
    levels.push({ depth: 0, options: current });

    for (let depth = 0; depth < pathIds.length; depth++) {
      const selId = pathIds[depth];
      const node = current.find((entry) => entry.id === selId);
      if (!node || !node.children || node.children.length === 0) {
        break;
      }
      current = node.children;
      levels.push({ depth: depth + 1, options: current });
    }

    return levels;
  }, [pathIds, schema]);

  const pathNodes = useMemo(() => {
    return pathIds
      .map((id) => nodeById.get(id))
      .filter((node): node is TaggingNode => Boolean(node));
  }, [nodeById, pathIds]);

  const selectedPathLabel = primaryId ? pathIndex.get(primaryId)?.labels.join(" > ") ?? null : null;

  const availableFacetGroupIds = useMemo(() => {
    const ids = new Set<string>();
    pathNodes.forEach((node) => {
      node.facet_group_ids?.forEach((id) => ids.add(id));
    });
    return Array.from(ids);
  }, [pathNodes]);

  const facetGroups = useMemo(() => {
    return availableFacetGroupIds
      .map((id) => facetGroupMap.get(id))
      .filter((group): group is TaggingFacetGroup => Boolean(group));
  }, [availableFacetGroupIds, facetGroupMap]);

  const isFacetGroupEnabled = useMemo(() => {
    return (group: TaggingFacetGroup) => {
      if (!group.requires_any || group.requires_any.length === 0) return true;
      return group.requires_any.some((req) => facetSelections[req.facet_group_id] === req.option_id);
    };
  }, [facetSelections]);

  useEffect(() => {
    if (!open) return;
    let changed = false;
    const next: TaggingSelection = {
      primary: currentSelection.primary ?? null,
      facets: { ...facetSelections },
    };

    Object.keys(next.facets).forEach((groupId) => {
      if (!availableFacetGroupIds.includes(groupId)) {
        delete next.facets[groupId];
        changed = true;
      }
    });

    facetGroups.forEach((group) => {
      if (!isFacetGroupEnabled(group) && next.facets[group.id] !== undefined) {
        delete next.facets[group.id];
        changed = true;
      }
    });

    if (changed) {
      onSelectionChange(next);
    }
  }, [
    availableFacetGroupIds,
    facetGroups,
    isFacetGroupEnabled,
    currentSelection.primary,
    facetSelections,
    onSelectionChange,
    open,
  ]);

  const handlePrimarySelect = (value: string) => {
    onSelectionChange({
      primary: value,
      facets: { ...facetSelections },
    });
  };

  const handleFacetSingleChange = (groupId: string, value: string) => {
    const next = { ...facetSelections };
    if (!value) {
      delete next[groupId];
    } else {
      next[groupId] = value;
    }
    onSelectionChange({ primary: currentSelection.primary ?? null, facets: next });
  };

  const handleFacetMultiToggle = (groupId: string, optionId: string, checked: boolean) => {
    const existing = Array.isArray(facetSelections[groupId]) ? (facetSelections[groupId] as string[]) : [];
    const nextSet = new Set(existing);
    if (checked) {
      nextSet.add(optionId);
    } else {
      nextSet.delete(optionId);
    }
    const next = { ...facetSelections };
    if (nextSet.size === 0) {
      delete next[groupId];
    } else {
      next[groupId] = Array.from(nextSet);
    }
    onSelectionChange({ primary: currentSelection.primary ?? null, facets: next });
  };

  if (!open) return null;

  const menuStyleResolved: React.CSSProperties = {
    position: "fixed",
    top: menuPosition?.top ?? anchorPoint?.y ?? 120,
    left: menuPosition?.left ?? anchorPoint?.x ?? 120,
    zIndex: 50,
    minWidth: 280,
    maxWidth: "calc(100vw - 24px)",
    maxHeight: "calc(100vh - 24px)",
    overflow: "auto",
    padding: "4px 0",
    borderRadius: 6,
    border: "1px solid rgba(51,65,85,0.8)",
    background: "#1e293b",
    boxShadow: "0 6px 16px rgba(0,0,0,0.3)",
    ...menuStyle,
  };

  const optionButtonBase: React.CSSProperties = {
    width: "100%",
    textAlign: "left",
    padding: "4px 10px",
    borderRadius: 4,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
  };

  const optionButtonSelected: React.CSSProperties = {
    background: "rgba(255,255,255,0.1)",
  };

  const optionButtonLabel: React.CSSProperties = {
    ...optionButtonBase,
    fontWeight: 600,
    opacity: 0.5,
    cursor: "default",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "6px 10px 2px",
  };

  const getOptionStyle = (isSelected: boolean): React.CSSProperties => ({
    ...optionButtonBase,
    ...(isSelected ? optionButtonSelected : null),
  });

  return (
    <div ref={menuRef} style={menuStyleResolved}>
      {schemaError ? (
        <div className="status">Failed to load tagging schema: {schemaError}</div>
      ) : !schema ? (
        <div className="status">Loading tagging schema...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {levelOptions.map((level) => (
              <div key={level.depth} style={{ minWidth: 170, borderRight: "1px solid rgba(255,255,255,0.08)", paddingRight: 8 }}>
                {level.options.map((option) => {
                  const isSelected = pathIds[level.depth] === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handlePrimarySelect(option.id)}
                      onDoubleClick={() => onClose({ primary: option.id, facets: { ...facetSelections } }, "confirm")}
                      style={getOptionStyle(isSelected)}
                    >
                      <span>{option.label}</span>
                      {option.children?.length ? <span style={{ opacity: 0.6 }}>&gt;</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {onClear ? (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: "4px 0" }}>
              <button
                type="button"
                onClick={() => { onClear(); onClose(createEmptyTaggingSelection(), "confirm"); }}
                style={{ ...optionButtonBase, opacity: 0.7 }}
              >
                Clear tags
              </button>
            </div>
          ) : null}

          {facetGroups.length > 0 ? (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6 }}>
              {facetGroups.map((group) => {
                const enabled = isFacetGroupEnabled(group);
                if (!enabled) {
                  return (
                    <div key={group.id} style={{ opacity: 0.55, fontSize: 12, padding: "2px 4px" }}>
                      {group.label}
                    </div>
                  );
                }

                if (group.mode === "multi") {
                  const selected = new Set(
                    Array.isArray(facetSelections[group.id]) ? (facetSelections[group.id] as string[]) : [],
                  );
                  return (
                    <div key={group.id} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <div style={optionButtonLabel}>{group.label}</div>
                      {group.options.map((option) => {
                        const isSelected = selected.has(option.id);
                        const nextSelection: TaggingSelection = {
                          primary: currentSelection.primary ?? null,
                          facets: {
                            ...facetSelections,
                            [group.id]: isSelected
                              ? Array.from(selected).filter((id) => id !== option.id)
                              : Array.from(new Set([...selected, option.id])),
                          },
                        };
                        if (Array.isArray(nextSelection.facets[group.id]) && (nextSelection.facets[group.id] as string[]).length === 0) {
                          delete nextSelection.facets[group.id];
                        }
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => handleFacetMultiToggle(group.id, option.id, !isSelected)}
                            onDoubleClick={() => onClose(nextSelection, "confirm")}
                            style={getOptionStyle(isSelected)}
                          >
                            <span>{isSelected ? "[x] " : "[ ] "}{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                }

                const currentValue = (facetSelections[group.id] as string) ?? "";
                return (
                  <div key={group.id} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    <div style={optionButtonLabel}>{group.label}</div>
                    {group.options.map((option) => {
                      const isSelected = currentValue === option.id;
                      const nextSelection: TaggingSelection = {
                        primary: currentSelection.primary ?? null,
                        facets: {
                          ...facetSelections,
                          [group.id]: isSelected ? "" : option.id,
                        },
                      };
                      if (isSelected) {
                        delete nextSelection.facets[group.id];
                      }
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleFacetSingleChange(group.id, isSelected ? "" : option.id)}
                          onDoubleClick={() => onClose(nextSelection, "confirm")}
                          style={getOptionStyle(isSelected)}
                        >
                          <span>{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
