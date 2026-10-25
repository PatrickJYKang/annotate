import { describe, expect, it } from 'vitest';
import { frameBoundary, videoFrame } from '../clip/frameMath';
import type { Clip } from '../types/clip';
import type { TaggingBoard } from './board';
import { retagClip, UNTAGGED_CLIP_LABEL } from './clipLabel';

const board: TaggingBoard = {
  schema: 'tagging-board.v1',
  defaults: { leadSeconds: 0, lagSeconds: 0, mode: 'range' },
  groups: [{ id: 'play', label: 'Play', buttons: [
    { id: 'possession', label: 'Possession' },
    { id: 'throw-in', label: 'Throw in' },
    { id: 'pass', label: 'Pass' },
  ] }],
  facets: [],
};
const clip: Clip = {
  schema: 'clip.v2', id: 'clip', videoId: 'video',
  startFrame: videoFrame(0), endFrame: frameBoundary(100),
  label: 'Possession', tags: { primary: 'possession', facets: {} },
  pins: [], annotations: [],
};
const tags = { primary: 'throw-in', facets: {} };

describe('re-tagged clip names', () => {
  it('updates a legacy generated name and remembers subsequent generated names', () => {
    const updated = retagClip(clip, tags, board);
    expect(updated).toMatchObject({ label: 'Throw in', generatedLabel: 'Throw in', tags });
    expect(retagClip(updated, { primary: 'pass', facets: {} }, board)).toMatchObject({
      label: 'Pass', generatedLabel: 'Pass',
    });
    expect(clip.label).toBe('Possession');
    expect(clip.tags.primary).toBe('possession');
  });

  it('preserves custom names even when they match a later tag', () => {
    const custom = { ...clip, label: 'Throw in' };
    const updated = retagClip(custom, tags, board);
    expect(updated).toMatchObject({ label: 'Throw in', generatedLabel: null, tags });
    expect(retagClip(updated, { primary: 'pass', facets: {} }, board)).toMatchObject({
      label: 'Throw in', generatedLabel: null,
    });
  });

  it('preserves an explicitly custom name even if it equals the old tag default', () => {
    expect(retagClip({ ...clip, generatedLabel: null }, tags, board)).toMatchObject({
      label: 'Possession', generatedLabel: null,
    });
  });

  it('detects a manual rename of a previously generated label', () => {
    expect(retagClip({ ...clip, label: 'Build-up on the left', generatedLabel: 'Possession' }, tags, board))
      .toMatchObject({ label: 'Build-up on the left', generatedLabel: null, tags });
  });

  it('uses recorded provenance even after a board label was edited or removed', () => {
    const renamedBoard = { ...board, groups: [{ ...board.groups[0], buttons: board.groups[0].buttons.slice(1) }] };
    expect(retagClip({ ...clip, generatedLabel: 'Possession' }, tags, renamedBoard))
      .toMatchObject({ label: 'Throw in', generatedLabel: 'Throw in' });
    expect(retagClip(clip, tags, renamedBoard).label).toBe('Possession');
  });

  it('generates names for unnamed and untagged legacy clips', () => {
    for (const label of [undefined, '', UNTAGGED_CLIP_LABEL]) {
      expect(retagClip({ ...clip, label, tags: { primary: null, facets: {} } }, tags, board))
        .toMatchObject({ label: 'Throw in', generatedLabel: 'Throw in' });
    }
  });

  it('clears tags with a generated untagged name but leaves custom names intact', () => {
    const cleared = { primary: null, facets: {} };
    const updated = retagClip(clip, cleared, board);
    expect(updated).toMatchObject({ label: UNTAGGED_CLIP_LABEL, generatedLabel: UNTAGGED_CLIP_LABEL, tags: cleared });
    expect(retagClip(updated, tags, board).label).toBe('Throw in');
    expect(retagClip({ ...clip, label: 'Custom' }, cleared, board).label).toBe('Custom');
  });

  it('does not rename a clip when only facets change', () => {
    const facets = { primary: 'possession', facets: { outcome: 'turnover' } };
    expect(retagClip(clip, facets, board)).toEqual({ ...clip, tags: facets });
  });

  it('does not invent a name if the target tag or board is missing', () => {
    expect(retagClip(clip, { primary: 'unknown', facets: {} }, board).label).toBe('Possession');
    expect(retagClip(clip, tags, null).label).toBe('Possession');
    expect(retagClip(clip, tags, null, 'Displayed label').label).toBe('Possession');
  });

  it('uses the displayed label without using it to identify a legacy generated name', () => {
    const updated = retagClip(clip, tags, board, 'Touche');
    expect(updated).toMatchObject({ label: 'Touche', generatedLabel: 'Touche', tags });
    expect(retagClip(updated, { primary: 'pass', facets: {} }, board, 'Pase'))
      .toMatchObject({ label: 'Pase', generatedLabel: 'Pase' });
    expect(retagClip(updated, { primary: null, facets: {} }, board, 'Clip sin etiquetas'))
      .toMatchObject({ label: 'Clip sin etiquetas', generatedLabel: 'Clip sin etiquetas' });
  });

  it('does not translate custom names or rename clips on facet-only edits', () => {
    const localized = { ...clip, label: 'Posesi\u00f3n', generatedLabel: 'Posesi\u00f3n' };
    expect(retagClip(localized, clip.tags, board, 'Possession')).toEqual(localized);
    const custom = { ...localized, label: 'My analysis' };
    expect(retagClip(custom, tags, board, 'Touche')).toMatchObject({ label: 'My analysis', generatedLabel: null });
    expect(retagClip({ ...clip, generatedLabel: null }, tags, board, 'Touche'))
      .toMatchObject({ label: 'Possession', generatedLabel: null });
  });

  it('falls back to the authored label if no display label is supplied', () => {
    expect(retagClip(clip, tags, board, '  ')).toMatchObject({ label: 'Throw in', generatedLabel: 'Throw in' });
  });
});
