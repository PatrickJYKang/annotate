import { describe, expect, it } from 'vitest';

import type { TaggingBoard } from './board';
import { buildHotkeyMap, createCaptureEngine } from './capture';
import type { TaggingSelection } from './selection';

function board(): TaggingBoard {
  return {
    schema: 'tagging-board.v1',
    defaults: { leadSeconds: 0, lagSeconds: 0, mode: 'range' },
    groups: [{
      id: 'events',
      label: 'Events',
      buttons: [
        { id: 'pass', label: 'Pass', hotkey: 'p', facetGroupIds: ['outcome', 'goal.method'] },
        { id: 'range-a', label: 'Range A', hotkey: 'a', mode: 'range', facetGroupIds: ['outcome'] },
        { id: 'range-b', label: 'Range B', hotkey: 'b', mode: 'range', facetGroupIds: ['outcome'] },
        { id: 'collision', label: 'Collision', hotkey: 'x' },
      ],
    }],
    facets: [
      {
        id: 'outcome',
        label: 'Outcome',
        mode: 'single',
        options: [
          { id: 'goal', label: 'Goal', hotkey: 'g' },
          { id: 'turnover', label: 'Turnover', hotkey: 'x' },
        ],
      },
      {
        id: 'goal.method',
        label: 'Goal method',
        mode: 'single',
        requiresAny: [{ facetGroupId: 'outcome', optionId: 'goal' }],
        options: [{ id: 'header', label: 'Header', hotkey: 'h' }],
      },
    ],
  };
}

function engineWithFacets(facets: TaggingSelection['facets'] = {}) {
  let armed = structuredClone(facets);
  let nextId = 1;
  const engine = createCaptureEngine({
    board: board(),
    videoFrameCount: 10,
    videoFps: 10,
    videoId: 'video-1',
    getArmedFacets: () => armed,
    onFacetsConsumed: (groupIds) => {
      armed = Object.fromEntries(Object.entries(armed).filter(([groupId]) => !groupIds.includes(groupId)));
    },
    createId: () => `clip-${nextId++}`,
  });
  return { engine, getArmed: () => armed, setArmed: (next: TaggingSelection['facets']) => { armed = next; } };
}

describe('capture engine', () => {
  it('treats every board button as a start/stop range toggle', () => {
    const { engine } = engineWithFacets();
    const first = engine.pressButton('pass', 0);
    const last = engine.pressButton('pass', 9);
    expect(first).toMatchObject({ kind: 'armed', range: { startFrame: 0 } });
    expect(last).toMatchObject({ kind: 'created', mode: 'range', clip: { startFrame: 0, endFrame: 10 } });
  });

  it('keeps only applicable, requirement-satisfied facets and consumes the snapshot', () => {
    const context = engineWithFacets({
      outcome: 'goal',
      'goal.method': 'header',
      unrelated: 'value',
    });
    context.engine.pressButton('pass', 5);
    const result = context.engine.pressButton('pass', 6);
    expect(result).toMatchObject({
      kind: 'created',
      clip: { tags: { primary: 'pass', facets: { outcome: 'goal', 'goal.method': 'header' } } },
    });
    expect(context.getArmed()).toEqual({ unrelated: 'value' });

    context.setArmed({ outcome: 'turnover', 'goal.method': 'header' });
    context.engine.pressButton('pass', 7);
    expect(context.engine.pressButton('pass', 8)).toMatchObject({
      kind: 'created',
      clip: { tags: { facets: { outcome: 'turnover' } } },
    });
  });

  it('stores modifier changes independently on overlapping active ranges', () => {
    const { engine } = engineWithFacets();
    engine.pressButton('range-a', 1);
    engine.pressButton('range-b', 2);

    expect(engine.setRangeFacets('range-a', { outcome: 'goal' })).toMatchObject({
      buttonId: 'range-a',
      facets: { outcome: 'goal' },
    });
    expect(engine.setRangeFacets('range-b', { outcome: 'turnover' })).toMatchObject({
      buttonId: 'range-b',
      facets: { outcome: 'turnover' },
    });
    expect(engine.pressButton('range-a', 5)).toMatchObject({
      kind: 'created',
      clip: { tags: { facets: { outcome: 'goal' } } },
    });
    expect(engine.pressButton('range-b', 6)).toMatchObject({
      kind: 'created',
      clip: { tags: { facets: { outcome: 'turnover' } } },
    });
  });

  it('arms and closes range captures with an inclusive stop frame', () => {
    const { engine } = engineWithFacets({ outcome: 'goal' });
    expect(engine.pressButton('range-a', 3)).toMatchObject({ kind: 'armed', range: { startFrame: 3 } });
    expect(engine.pressButton('range-a', 3)).toMatchObject({
      kind: 'created', mode: 'range', clip: { startFrame: 3, endFrame: 4, tags: { facets: { outcome: 'goal' } } },
    });
  });

  it('keeps a range armed after a reversed close and supports simultaneous ranges', () => {
    const context = engineWithFacets({ outcome: 'goal' });
    context.engine.pressButton('range-a', 6);
    context.setArmed({ outcome: 'turnover' });
    context.engine.pressButton('range-b', 2);
    expect(context.engine.getActiveRanges().map((range) => range.buttonId)).toEqual(['range-a', 'range-b']);
    expect(context.engine.pressButton('range-a', 4)).toMatchObject({ kind: 'waiting' });
    expect(context.engine.pressButton('range-b', 5)).toMatchObject({
      kind: 'created', clip: { startFrame: 2, endFrame: 6, tags: { facets: { outcome: 'turnover' } } },
    });
    expect(context.engine.pressButton('range-a', 8)).toMatchObject({
      kind: 'created', clip: { startFrame: 6, endFrame: 9, tags: { facets: { outcome: 'goal' } } },
    });
  });

  it('cancels explicit, most-recent, and all active ranges', () => {
    const { engine } = engineWithFacets();
    engine.pressButton('range-a', 1);
    engine.pressButton('range-b', 2);
    expect(engine.cancelMostRecentRange()?.buttonId).toBe('range-b');
    expect(engine.cancelRange('range-a')?.buttonId).toBe('range-a');
    engine.pressButton('range-a', 3);
    engine.pressButton('range-b', 4);
    expect(engine.cancelAllRanges()).toHaveLength(2);
    expect(engine.getActiveRanges()).toEqual([]);
  });
});

describe('board hotkeys', () => {
  it('maps unique button/facet keys and disables collisions', () => {
    const hotkeys = buildHotkeyMap(board());
    expect(hotkeys.actions.get('p')).toEqual({ kind: 'button', buttonId: 'pass' });
    expect(hotkeys.actions.get('g')).toEqual({ kind: 'facet', facetGroupId: 'outcome', optionId: 'goal' });
    expect(hotkeys.actions.has('x')).toBe(false);
  });

  it('ignores modified shortcuts and text-entry targets', () => {
    const hotkeys = buildHotkeyMap(board());
    expect(hotkeys.resolve({ key: 'p' })).toEqual({ kind: 'button', buttonId: 'pass' });
    expect(hotkeys.resolve({ key: 'p', metaKey: true })).toBeNull();
    expect(hotkeys.resolve({ key: 'p', target: { tagName: 'INPUT' } as unknown as EventTarget })).toBeNull();
    expect(hotkeys.resolve({ key: 'p', target: { isContentEditable: true } as unknown as EventTarget })).toBeNull();
  });
});
