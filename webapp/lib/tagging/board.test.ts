import { describe, expect, it } from 'vitest';

import defaultBoardDocument from '../../public/tagging/board.json';
import {
  applicableFacetGroups,
  boardTagTree,
  conflictedBoardHotkeys,
  parseTaggingBoard,
  pruneInapplicableFacets,
  resolveButtonCapture,
  TaggingBoardValidationError,
  type TaggingBoard,
  validateTaggingBoard,
} from './board';

function defaultBoard(): TaggingBoard {
  return parseTaggingBoard(structuredClone(defaultBoardDocument));
}

describe('tagging board', () => {
  it('parses the canonical board with every legacy leaf action represented', () => {
    const board = defaultBoard();
    const buttonIds = board.groups.flatMap((group) => group.buttons.map((button) => button.id));

    expect(validateTaggingBoard(board)).toEqual([]);
    expect(buttonIds).toHaveLength(20);
    expect(buttonIds).toContain('offensive.open_play.pass');
    expect(buttonIds).toContain('defensive.set_piece.penalty');
    expect(boardTagTree(board)).toHaveLength(4);
    expect(board.layout).toMatchObject({ width: 960, height: 900 });
    expect(board.groups.every((group) => (
      !!group.labelRect && group.buttons.every((button) => !!button.rect)
    ))).toBe(true);
  });

  it('normalizes legacy instant and offset presets to range toggles at runtime', () => {
    const board = defaultBoard();
    const button = board.groups[0].buttons[0];
    button.leadSeconds = 5;
    button.lagSeconds = 9;
    button.mode = 'instant';

    expect(resolveButtonCapture(board, button.id)).toMatchObject({
      leadSeconds: 0,
      lagSeconds: 0,
      mode: 'range',
    });
    expect(() => resolveButtonCapture(board, 'missing')).toThrow('Unknown tagging-board button');
  });

  it('rejects board geometry outside the declared coordinate space', () => {
    const board = defaultBoard();
    board.groups[0].buttons[0].rect = { x: 1190, y: 0, width: 20, height: 20 };
    expect(validateTaggingBoard(board).map((issue) => issue.code)).toContain('invalid-layout');
  });

  it('migrates legacy 30 fps capture offsets into duration-based settings', () => {
    const migrated = parseTaggingBoard({
      ...structuredClone(defaultBoardDocument),
      defaults: { leadFrames: 75, lagFrames: 45, mode: 'instant' },
    });

    expect(migrated.defaults).toEqual({ leadSeconds: 2.5, lagSeconds: 1.5, mode: 'instant' });
  });

  it('returns facet groups in board order for the selected button', () => {
    const board = defaultBoard();

    expect(applicableFacetGroups(board, 'offensive.open_play.cross').map((facet) => facet.id)).toEqual([
      'cross.type',
      'cross.origin_depth',
      'outcome.general',
      'goal.method',
      'turnover.method',
    ]);
  });

  it('prunes unrelated and invalid facets while preserving satisfied dependencies', () => {
    const board = defaultBoard();
    const selected = pruneInapplicableFacets(board, 'offensive.open_play.pass', {
      primary: 'something.old',
      facets: {
        'zone.channel': 'wing',
        'outcome.pass': 'goal',
        'goal.method': 'header',
        'pass.type': 'switch',
        'unknown.group': 'unknown',
      },
    });

    expect(selected).toEqual({
      primary: 'offensive.open_play.pass',
      facets: {
        'pass.type': 'switch',
        'outcome.pass': 'goal',
        'goal.method': 'header',
      },
    });
  });

  it('removes dependent values when no requiresAny condition is selected', () => {
    const board = defaultBoard();
    const selected = pruneInapplicableFacets(board, 'offensive.open_play.pass', {
      primary: 'offensive.open_play.pass',
      facets: {
        'outcome.pass': 'complete',
        'goal.method': 'header',
      },
    });

    expect(selected.facets).toEqual({ 'outcome.pass': 'complete' });
  });

  it('reports unresolved applicability and requirement references', () => {
    const board = defaultBoard() as unknown as Record<string, any>;
    board.groups[0].buttons[0].facetGroupIds.push('missing.facet');
    board.facets[0].requiresAny = [{ facetGroupId: 'missing.facet', optionId: 'missing' }];

    expect(validateTaggingBoard(board).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unresolved-facet-reference', 'unresolved-requirement']),
    );
    expect(() => parseTaggingBoard(board)).toThrow(TaggingBoardValidationError);
  });

  it('rejects dependency cycles instead of relying on runtime pruning order', () => {
    const board = defaultBoard();
    const zone = board.facets.find((facet) => facet.id === 'zone.vertical_third')!;
    const channel = board.facets.find((facet) => facet.id === 'zone.channel')!;
    zone.requiresAny = [{ facetGroupId: channel.id, optionId: channel.options[0].id }];
    channel.requiresAny = [{ facetGroupId: zone.id, optionId: zone.options[0].id }];

    expect(validateTaggingBoard(board).filter((issue) => issue.code === 'facet-dependency-cycle')).toHaveLength(2);
  });

  it('warns on hotkey collisions and disables every conflicting key', () => {
    const board = defaultBoard();
    board.groups[0].buttons[0].hotkey = 'B';
    board.facets[0].options[0].hotkey = 'b';

    const collisions = validateTaggingBoard(board).filter((issue) => issue.code === 'hotkey-collision');
    expect(collisions).toHaveLength(2);
    expect(collisions.every((issue) => issue.severity === 'warning')).toBe(true);
    expect(conflictedBoardHotkeys(board)).toEqual(new Set(['b']));
    expect(() => parseTaggingBoard(board)).not.toThrow();
  });

  it('returns structured validation errors for malformed JSON', () => {
    try {
      parseTaggingBoard('{not-json');
      throw new Error('Expected parseTaggingBoard to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(TaggingBoardValidationError);
      expect((error as TaggingBoardValidationError).issues[0]).toMatchObject({
        severity: 'error',
        code: 'invalid-document',
      });
    }
  });
});
