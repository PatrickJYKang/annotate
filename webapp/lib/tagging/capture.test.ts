import { describe, expect, it, vi } from 'vitest';

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

function engineWithFacets(facets: TaggingSelection['facets'] = {}, captureBoard = board()) {
  let armed = structuredClone(facets);
  let nextId = 1;
  const engine = createCaptureEngine({
    board: captureBoard,
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
    expect(last).toMatchObject({ kind: 'created', mode: 'range', clip: {
      startFrame: 0, endFrame: 10, label: 'Pass', generatedLabel: 'Pass',
    } });
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

describe('exclusive captures', () => {
  function exclusiveBoard(): TaggingBoard {
    return { ...board(), exclusiveGroups: [{ id: 'phase', buttonIds: ['range-a', 'range-b'] }] };
  }

  it('switches both ways with a shared frame boundary while leaving unrelated captures active', () => {
    const { engine } = engineWithFacets({}, exclusiveBoard());
    engine.pressButton('range-a', 1);
    engine.pressButton('pass', 2);
    expect(engine.pressButton('range-b', 4)).toMatchObject({
      kind: 'armed', range: { buttonId: 'range-b', startFrame: 4 },
      closedClip: { startFrame: 1, endFrame: 4, tags: { primary: 'range-a' } },
    });
    expect(engine.getActiveRanges().map((range) => range.buttonId)).toEqual(['pass', 'range-b']);
    expect(engine.pressButton('range-a', 7)).toMatchObject({
      kind: 'armed', range: { buttonId: 'range-a', startFrame: 7 },
      closedClip: { startFrame: 4, endFrame: 7, tags: { primary: 'range-b' } },
    });
    expect(engine.pressButton('pass', 8)).toMatchObject({
      kind: 'created', clip: { startFrame: 2, endFrame: 9 },
    });
    expect(engine.pressButton('range-a', 9)).toMatchObject({
      kind: 'created', clip: { startFrame: 7, endFrame: 10 },
    });
  });

  it('preserves old modifiers without copying them to the new capture', () => {
    const { engine } = engineWithFacets({}, exclusiveBoard());
    engine.pressButton('range-a', 1);
    engine.setRangeFacets('range-a', { outcome: 'goal' });
    expect(engine.pressButton('range-b', 5)).toMatchObject({
      kind: 'armed', range: { facets: {} }, closedClip: { tags: { facets: { outcome: 'goal' } } },
    });
  });

  it('replaces an empty same-frame draft without creating zero-duration or overlapping clips', () => {
    const { engine } = engineWithFacets({}, exclusiveBoard());
    engine.pressButton('range-a', 0);
    const switched = engine.pressButton('range-b', 0);
    expect(switched).toMatchObject({ kind: 'armed', range: { buttonId: 'range-b', startFrame: 0 } });
    expect(switched).not.toHaveProperty('closedClip');
    expect(engine.getActiveRanges().map((range) => range.buttonId)).toEqual(['range-b']);
    expect(engine.pressButton('range-b', 0)).toMatchObject({
      kind: 'created', clip: { startFrame: 0, endFrame: 1 },
    });
  });

  it('does not switch backwards before the active capture started', () => {
    const { engine, getArmed, setArmed } = engineWithFacets({}, exclusiveBoard());
    engine.pressButton('range-a', 5);
    setArmed({ outcome: 'turnover' });
    expect(engine.pressButton('range-b', 3)).toMatchObject({ kind: 'waiting', range: { buttonId: 'range-a' } });
    expect(engine.getActiveRanges().map((range) => range.buttonId)).toEqual(['range-a']);
    expect(getArmed()).toEqual({ outcome: 'turnover' });
  });

  it('works with three-button groups and independent groups without any football-specific IDs', () => {
    const custom = board();
    custom.groups[0].buttons.push({ id: 'state-c', label: 'Third state' }, { id: 'other', label: 'Other' });
    custom.exclusiveGroups = [
      { id: 'phase', buttonIds: ['range-a', 'range-b', 'state-c'] },
      { id: 'other-phase', buttonIds: ['pass', 'other'] },
    ];
    const { engine } = engineWithFacets({}, custom);
    engine.pressButton('range-a', 0);
    engine.pressButton('pass', 1);
    engine.pressButton('state-c', 2);
    engine.pressButton('other', 3);
    expect(engine.getActiveRanges().map((range) => range.buttonId)).toEqual(['state-c', 'other']);
  });

  it('keeps captures and armed facets intact on a failed save, then retries without duplicate clips', async () => {
    const { engine, setArmed, getArmed } = engineWithFacets({}, exclusiveBoard());
    engine.pressButton('range-a', 1);
    engine.setRangeFacets('range-a', { outcome: 'goal' });
    setArmed({ outcome: 'turnover' });
    const before = engine.getActiveRanges();
    const persist = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    await expect(engine.pressButtonAndPersist('range-b', 4, persist)).rejects.toThrow('disk full');
    expect(engine.getActiveRanges()).toEqual(before);
    expect(getArmed()).toEqual({ outcome: 'turnover' });
    await engine.pressButtonAndPersist('range-b', 4, persist);
    expect(engine.getActiveRanges()).toMatchObject([{ buttonId: 'range-b', facets: { outcome: 'turnover' } }]);
    expect(getArmed()).toEqual({});
    expect(persist.mock.calls[1][0]).toMatchObject({ startFrame: 1, endFrame: 4, tags: { facets: { outcome: 'goal' } } });
  });

  it('does not let another press, cancellation or facet edit race a pending save', async () => {
    const { engine } = engineWithFacets({}, exclusiveBoard());
    engine.pressButton('range-a', 1);
    let release!: () => void;
    const saving = engine.pressButtonAndPersist('range-b', 4, () => new Promise<void>((resolve) => { release = resolve; }));
    expect(engine.getActiveRanges()).toMatchObject([{ buttonId: 'range-a' }]);
    expect(() => engine.pressButton('pass', 4)).toThrow('being saved');
    await expect(engine.pressButtonAndPersist('pass', 4, async () => {})).rejects.toThrow('being saved');
    expect(engine.cancelMostRecentRange()).toBeNull();
    expect(engine.cancelRange('range-a')).toBeNull();
    expect(engine.cancelAllRanges()).toEqual([]);
    expect(engine.setRangeFacets('range-a', { outcome: 'goal' })).toBeNull();
    release();
    await saving;
    expect(engine.getActiveRanges()).toMatchObject([{ buttonId: 'range-b' }]);
  });

  it('also retains a directly stopped capture when its save fails', async () => {
    const { engine } = engineWithFacets({}, exclusiveBoard());
    engine.pressButton('range-a', 1);
    await expect(engine.pressButtonAndPersist('range-a', 4, async () => { throw new Error('disk full'); }))
      .rejects.toThrow('disk full');
    expect(engine.getActiveRanges()).toMatchObject([{ buttonId: 'range-a', startFrame: 1 }]);
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
