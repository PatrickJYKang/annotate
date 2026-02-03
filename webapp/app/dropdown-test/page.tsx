"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchTaggingSchema, TaggingFacetGroup, TaggingNode, TaggingSchema } from "../../lib/tagging/schema";

type FacetSelections = Record<string, string | string[]>;

type LevelOption = {
  depth: number;
  options: TaggingNode[];
};

type PathInfo = {
  ids: string[];
  labels: string[];
};

export default function DropdownTestPage() {
  const [schema, setSchema] = useState<TaggingSchema | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [primaryId, setPrimaryId] = useState("");
  const [facetSelections, setFacetSelections] = useState<FacetSelections>({});
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    fetchTaggingSchema()
      .then((data) => {
        if (!active) return;
        setSchema(data);
      })
      .catch((err) => {
        if (!active) return;
        setSchemaError(err instanceof Error ? err.message : "Failed to load tagging schema");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        setIsOpen(false);
      }
    };
    const handleClick = (event: MouseEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClick);
    };
  }, [isOpen]);

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

  const selectedPrimary = primaryId ? nodeById.get(primaryId) ?? null : null;
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
      .filter((group): group is TaggingFacetGroup => !!group);
  }, [availableFacetGroupIds, facetGroupMap]);

  const isFacetGroupEnabled = useMemo(() => {
    return (group: TaggingFacetGroup) => {
      if (!group.requires_any || group.requires_any.length === 0) return true;
      return group.requires_any.some((req) => facetSelections[req.facet_group_id] === req.option_id);
    };
  }, [facetSelections]);

  useEffect(() => {
    setFacetSelections((prev) => {
      let changed = false;
      const next: FacetSelections = { ...prev };

      Object.keys(next).forEach((groupId) => {
        if (!availableFacetGroupIds.includes(groupId)) {
          delete next[groupId];
          changed = true;
        }
      });

      facetGroups.forEach((group) => {
        if (!isFacetGroupEnabled(group) && next[group.id] !== undefined) {
          delete next[group.id];
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [availableFacetGroupIds, facetGroups, isFacetGroupEnabled]);

  const handlePrimarySelect = (value: string) => {
    setPrimaryId(value);
  };

  const handleFacetSingleChange = (groupId: string, value: string) => {
    setFacetSelections((prev) => {
      const next = { ...prev };
      if (!value) {
        delete next[groupId];
      } else {
        next[groupId] = value;
      }
      return next;
    });
  };

  const handleFacetMultiToggle = (groupId: string, optionId: string, checked: boolean) => {
    setFacetSelections((prev) => {
      const existing = Array.isArray(prev[groupId]) ? (prev[groupId] as string[]) : [];
      const nextSet = new Set(existing);
      if (checked) {
        nextSet.add(optionId);
      } else {
        nextSet.delete(optionId);
      }
      const next: FacetSelections = { ...prev };
      if (nextSet.size === 0) {
        delete next[groupId];
      } else {
        next[groupId] = Array.from(nextSet);
      }
      return next;
    });
  };

  if (schemaError) {
    return (
      <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
        <div className="header" style={{ marginBottom: 12 }}>
          <h1>Dropdown Test</h1>
          <div className="subtle">Primary path + facet tags</div>
        </div>
        <div className="status">Failed to load tagging schema: {schemaError}</div>
      </div>
    );
  }

  if (!schema) {
    return (
      <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
        <div className="header" style={{ marginBottom: 12 }}>
          <h1>Dropdown Test</h1>
          <div className="subtle">Primary path + facet tags</div>
        </div>
        <div className="status">Loading tagging schema...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div className="header" style={{ marginBottom: 12 }}>
        <h1>Dropdown Test</h1>
        <div className="subtle">Primary path + facet tags</div>
      </div>

      <div className="panel" style={{ marginBottom: 16, position: "relative" }} ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(0,0,0,0.25)",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          {selectedPathLabel ? `Primary: ${selectedPathLabel}` : "Select primary + facets"}
        </button>

        {isOpen && (
          <div
            style={{
              position: "absolute",
              zIndex: 20,
              top: "calc(100% + 8px)",
              left: 0,
              right: 0,
              padding: 16,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(12,12,16,0.95)",
              boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1.2fr) minmax(260px, 1fr)", gap: 16 }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Primary path</div>
                <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
                  {levelOptions.map((level) => (
                    <div key={level.depth} style={{ minWidth: 200, borderRight: "1px solid rgba(255,255,255,0.08)", paddingRight: 12 }}>
                      {level.options.map((option) => {
                        const isSelected = pathIds[level.depth] === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => handlePrimarySelect(option.id)}
                            onDoubleClick={() => setIsOpen(false)}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: "6px 8px",
                              borderRadius: 8,
                              border: "1px solid transparent",
                              background: isSelected ? "rgba(255,255,255,0.18)" : "transparent",
                              color: "inherit",
                              cursor: "pointer",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <span>{option.label}</span>
                            {option.children?.length ? <span style={{ opacity: 0.6 }}>›</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="status" style={{ marginTop: 8 }}>
                  {selectedPathLabel ? `Current: ${selectedPathLabel}` : "Select a path."}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Facet tags</div>
                {facetGroups.length === 0 ? (
                  <div className="status">Select a primary path to see available facets.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {facetGroups.map((group) => {
                      const enabled = isFacetGroupEnabled(group);
                      if (!enabled) {
                        return (
                          <div key={group.id} style={{ opacity: 0.5, fontSize: 12 }}>
                            {group.label} (requires: {group.requires_any?.map((req) => `${req.facet_group_id}=${req.option_id}`).join(" OR ")})
                          </div>
                        );
                      }

                      if (group.mode === "multi") {
                        const selected = new Set(
                          Array.isArray(facetSelections[group.id]) ? (facetSelections[group.id] as string[]) : [],
                        );
                        return (
                          <div key={group.id} style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                            <div style={{ fontWeight: 600 }}>{group.label}</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {group.options.map((option) => {
                                const isSelected = selected.has(option.id);
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => handleFacetMultiToggle(group.id, option.id, !isSelected)}
                                    onDoubleClick={() => setIsOpen(false)}
                                    style={{
                                      padding: "6px 10px",
                                      borderRadius: 999,
                                      border: "1px solid rgba(255,255,255,0.2)",
                                      background: isSelected ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.25)",
                                      color: "inherit",
                                      cursor: "pointer",
                                    }}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }

                      const currentValue = (facetSelections[group.id] as string) ?? "";
                      return (
                        <div key={group.id} style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                          <div style={{ fontWeight: 600 }}>{group.label}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {group.options.map((option) => {
                              const isSelected = currentValue === option.id;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => handleFacetSingleChange(group.id, isSelected ? "" : option.id)}
                                  onDoubleClick={() => setIsOpen(false)}
                                  style={{
                                    padding: "6px 10px",
                                    borderRadius: 999,
                                    border: "1px solid rgba(255,255,255,0.2)",
                                    background: isSelected ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.25)",
                                    color: "inherit",
                                    cursor: "pointer",
                                  }}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="status" style={{ marginTop: 12 }}>
              Tip: double-click a tag or press Enter to finish.
            </div>
          </div>
        )}

        <div className="status" style={{ marginTop: 12 }}>
          Primary selection: {selectedPathLabel ? `${selectedPathLabel} (${selectedPrimary?.id ?? primaryId})` : "—"}
        </div>
      </div>

      <div className="panel">
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Current selection</div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {JSON.stringify(
            {
              primary: selectedPrimary?.id ?? null,
              facets: facetSelections,
            },
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  );
}
