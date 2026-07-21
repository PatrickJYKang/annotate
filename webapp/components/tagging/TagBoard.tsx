"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applicableFacetGroups,
  conflictedBoardHotkeys,
  facetRequirementsSatisfied,
  resolveBoardButtonRect,
  resolveBoardGroupLabelRect,
  resolveTaggingBoardLayout,
  type BoardFacetGroup,
  type BoardRect,
  type TaggingBoard,
} from '../../lib/tagging/board';
import type { ActiveRangeCapture } from '../../lib/tagging/capture';
import type { TaggingSelection } from '../../lib/tagging/selection';
import { useT } from '../../lib/i18n';

export type TagBoardMode = 'capture' | 'retag';

interface TagBoardProps {
  board: TaggingBoard;
  armedFacets: TaggingSelection['facets'];
  activeRangeCaptures: readonly ActiveRangeCapture[];
  mode: TagBoardMode;
  disabled?: boolean;
  onButtonPress: (buttonId: string) => void | Promise<void>;
  onFacetToggle: (facetGroupId: string, optionId: string, contextButtonId: string | null) => void;
}

function facetValueSelected(
  facets: TaggingSelection['facets'],
  group: BoardFacetGroup,
  optionId: string,
): boolean {
  const selected = facets[group.id];
  return group.mode === 'multi'
    ? Array.isArray(selected) && selected.includes(optionId)
    : selected === optionId;
}

function firstButtonId(board: TaggingBoard): string | null {
  return board.groups[0]?.buttons[0]?.id ?? null;
}

function rectStyle(rect: BoardRect): React.CSSProperties {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

export default function TagBoard({
  board,
  armedFacets,
  activeRangeCaptures,
  mode,
  disabled = false,
  onButtonPress,
  onFacetToggle,
}: TagBoardProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [contextButtonId, setContextButtonId] = useState<string | null>(() => firstButtonId(board));
  const layout = resolveTaggingBoardLayout(board);
  const collisions = useMemo(() => conflictedBoardHotkeys(board), [board]);
  const activeByButton = useMemo(() => new Map(
    activeRangeCaptures.map((range) => [range.buttonId, range]),
  ), [activeRangeCaptures]);
  const latestActiveId = activeRangeCaptures[activeRangeCaptures.length - 1]?.buttonId ?? null;
  const resolvedContextId = contextButtonId ?? latestActiveId ?? firstButtonId(board);
  const contextFacets = resolvedContextId
    ? activeByButton.get(resolvedContextId)?.facets ?? armedFacets
    : armedFacets;
  const selection = useMemo<TaggingSelection>(() => ({
    primary: resolvedContextId,
    facets: contextFacets,
  }), [contextFacets, resolvedContextId]);
  const visibleFacets = useMemo(() => {
    if (!resolvedContextId) return [];
    return applicableFacetGroups(board, resolvedContextId)
      .filter((facet) => facetRequirementsSatisfied(facet, selection))
      .slice(0, layout.modifierSlots.length);
  }, [board, layout.modifierSlots.length, resolvedContextId, selection]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const exists = contextButtonId && board.groups.some((group) => (
      group.buttons.some((button) => button.id === contextButtonId)
    ));
    if (!exists) setContextButtonId(latestActiveId ?? firstButtonId(board));
  }, [board, contextButtonId, latestActiveId]);

  const scale = containerSize.width > 0 && containerSize.height > 0
    ? Math.min(containerSize.width / layout.width, containerSize.height / layout.height)
    : 0;
  const surfaceWidth = layout.width * scale;
  const surfaceHeight = layout.height * scale;

  return (
    <section className="h-full min-h-0 bg-surface" data-testid="tag-board">
      <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-canvas">
        <div
          className="absolute bg-surface"
          style={{
            width: layout.width,
            height: layout.height,
            left: Math.max(0, (containerSize.width - surfaceWidth) / 2),
            top: Math.max(0, (containerSize.height - surfaceHeight) / 2),
            opacity: scale > 0 ? 1 : 0,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {board.groups.map((group, groupIndex) => {
            const labelRect = resolveBoardGroupLabelRect(group, groupIndex);
            return (
              <section key={group.id} data-testid={`tag-board-group-${group.id}`}>
                <h3
                  className="absolute m-0 flex items-center text-[18px] font-semibold text-secondary"
                  style={rectStyle(labelRect)}
                >
                  {group.label}
                </h3>
                {group.buttons.map((button, buttonIndex) => {
                  const active = activeByButton.get(button.id);
                  const hotkey = button.hotkey?.trim().toLocaleLowerCase();
                  const showHotkey = !!hotkey && !collisions.has(hotkey);
                  const rect = resolveBoardButtonRect(group, groupIndex, buttonIndex);
                  return (
                    <button
                      key={button.id}
                      type="button"
                      data-testid={`tag-board-button-${button.id}`}
                      disabled={disabled}
                      aria-pressed={!!active}
                      onMouseEnter={() => setContextButtonId(button.id)}
                      onFocus={() => setContextButtonId(button.id)}
                      onClick={() => {
                        setContextButtonId(button.id);
                        void onButtonPress(button.id);
                      }}
                      className={`absolute flex flex-col items-start justify-between overflow-hidden px-3 py-3 text-left text-[20px] font-semibold ${
                        resolvedContextId === button.id && !active ? 'border-secondary' : ''
                      }`}
                      style={rectStyle(rect)}
                    >
                      <span className="min-w-0 pr-5 leading-tight">{button.label}</span>
                      {active && <span className="absolute right-3 top-3 h-4 w-4 rounded-full bg-danger" aria-hidden="true" />}
                      <span className="flex w-full items-end justify-between text-[15px] font-normal text-muted">
                        <span>{active ? t('tagBoard.fromFrame', { frame: active.startFrame }) : ''}</span>
                        {showHotkey && <kbd className="font-mono">{hotkey}</kbd>}
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}

          {visibleFacets.map((facet, facetIndex) => {
            const slot = layout.modifierSlots[facetIndex];
            return (
              <fieldset
                key={facet.id}
                className="absolute m-0 border-0 border-t border-solid border-border p-0 pt-3"
                style={rectStyle(slot)}
                data-testid={`tag-board-facet-${facet.id}`}
              >
                <legend className="mb-3 w-full text-[17px] font-semibold text-secondary">
                  {facet.label}{facet.mode === 'multi' ? ` · ${t('tagBoard.multiple')}` : ''}
                </legend>
                <div
                  className="grid grid-cols-2 auto-rows-fr gap-2"
                  style={{ height: Math.max(0, slot.height - 38) }}
                >
                  {facet.options.map((option) => {
                    const selected = facetValueSelected(contextFacets, facet, option.id);
                    const hotkey = option.hotkey?.trim().toLocaleLowerCase();
                    const showHotkey = !!hotkey && !collisions.has(hotkey);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={disabled}
                        aria-pressed={selected}
                        onClick={() => onFacetToggle(facet.id, option.id, resolvedContextId)}
                        className="min-h-0 px-3 py-2 text-left text-[17px]"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span>{option.label}</span>
                          {showHotkey && <kbd className="font-mono text-[14px] text-muted">{hotkey}</kbd>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          <span
            data-testid="tag-board-mode"
            className={`absolute right-6 text-[15px] ${mode === 'retag' ? 'text-warning' : 'text-muted'}`}
            style={{ top: Math.max(0, layout.modifierSlots[0].y - 28) }}
          >
            {t(`tagBoard.${mode}`)}
          </span>
        </div>
      </div>
    </section>
  );
}
