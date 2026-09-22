import { describe, expect, it } from 'vitest';
import defaultDocument from '../../public/tagging/board.json';
import legacyDocument from '../../e2e/fixtures/clip-editor-project/tagging-board.json';
import type { Locale } from '../i18n';
import { parseTaggingBoard, validateTaggingBoard, type TaggingBoard } from './board';
import { createCaptureEngine } from './capture';
import labels from './defaultBoardLabels.json';
import { localizeDefaultTaggingBoard } from './localizedBoard';

const locales: Locale[] = ['en', ...Object.keys(labels) as Exclude<Locale, 'en'>[]];

function withoutLabels(board: TaggingBoard): unknown {
  return JSON.parse(JSON.stringify(board, (key, value) => key === 'label' ? undefined : value));
}

describe('built-in tagging board languages', () => {
  it('covers every group, tile, facet and option in every translated language', () => {
    const board = parseTaggingBoard(defaultDocument);
    const vocabulary = new Set([
      ...board.groups.flatMap((group) => [group.label, ...group.buttons.map((button) => button.label)]),
      ...board.facets.flatMap((facet) => [facet.label, ...facet.options.map((option) => option.label)]),
    ]);
    for (const catalog of Object.values(labels)) {
      expect(Object.keys(catalog).sort()).toEqual([...vocabulary].sort());
      expect(Object.values(catalog).every((value) => value.trim().length > 0)).toBe(true);
    }
  });

  it.each([['current', defaultDocument], ['legacy', legacyDocument]])(
    'switches %s defaults between every language without changing IDs, layout or capture settings',
    (_name, document) => {
      const board = parseTaggingBoard(document);
      const original = structuredClone(board);
      for (const from of locales) {
        const startingBoard = localizeDefaultTaggingBoard(board, from);
        for (const to of locales) {
          const translated = localizeDefaultTaggingBoard(startingBoard, to);
          expect(translated).toEqual(localizeDefaultTaggingBoard(board, to));
          expect(withoutLabels(translated)).toEqual(withoutLabels(board));
          expect(validateTaggingBoard(translated).filter((issue) => issue.severity === 'error')).toEqual([]);
        }
      }
      expect(board).toEqual(original);
      expect(localizeDefaultTaggingBoard(board, 'en')).toBe(board);
    },
  );

  it('matches JSON with different property ordering', () => {
    const reordered = JSON.parse(JSON.stringify(defaultDocument, (_key, value) => (
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse()) : value
    )));
    expect(localizeDefaultTaggingBoard(parseTaggingBoard(reordered), 'es').groups[0].label)
      .toBe('Ataque - juego abierto');
  });

  const customizations: [string, (board: TaggingBoard) => void][] = [
    ['renamed group', (board) => { board.groups[0].label = 'My attack'; }],
    ['renamed tile', (board) => { board.groups[0].buttons[0].label = 'My possession'; }],
    ['renamed option', (board) => { board.facets[0].options[0].label = 'Own half'; }],
    ['custom hotkey', (board) => { board.groups[0].buttons[0].hotkey = 'p'; }],
    ['custom layout', (board) => { board.layout!.width = 1200; }],
    ['custom defaults', (board) => { board.defaults.leadSeconds = 1; }],
    ['custom applicability', (board) => { board.groups[0].buttons[0].facetGroupIds = []; }],
    ['custom requirements', (board) => { board.facets.at(-1)!.requiresAny = []; }],
    ['reordered tiles', (board) => { board.groups[0].buttons.reverse(); }],
    ['removed tile', (board) => { board.groups[0].buttons.pop(); }],
  ];
  it.each(customizations)('leaves a %s untouched even when IDs match the default', (_name, customize) => {
    const board = parseTaggingBoard(defaultDocument);
    customize(board);
    for (const locale of locales) expect(localizeDefaultTaggingBoard(board, locale)).toBe(board);
  });

  it('keeps captures and chosen modifiers intact during a language switch', () => {
    const board = parseTaggingBoard(defaultDocument);
    const engine = createCaptureEngine({ board, videoFrameCount: 1000, videoFps: 30, videoId: 'video' });
    const id = 'offensive.open_play.possession';
    engine.pressButton(id, 10);
    engine.setRangeFacets(id, { 'zone.vertical_third': 'final_third' });
    const before = engine.getActiveRanges();
    localizeDefaultTaggingBoard(board, 'fr');
    localizeDefaultTaggingBoard(board, 'zh-CN');
    expect(engine.getActiveRanges()).toEqual(before);
    const result = engine.pressButton(id, 30);
    expect(result.kind).toBe('created');
    if (result.kind === 'created') {
      expect(result.clip.tags).toEqual({ primary: id, facets: { 'zone.vertical_third': 'final_third' } });
      expect([result.clip.startFrame, result.clip.endFrame]).toEqual([10, 31]);
    }
  });

  it('does not replace a customized translated default or mutate cached translations', () => {
    const board = parseTaggingBoard(defaultDocument);
    const french = localizeDefaultTaggingBoard(board, 'fr');
    french.groups[0].label = 'My custom French board';
    expect(localizeDefaultTaggingBoard(french, 'es')).toBe(french);
    expect(localizeDefaultTaggingBoard(board, 'fr').groups[0].label).toBe('Attaque - jeu ouvert');
    expect(localizeDefaultTaggingBoard(null, 'fr')).toBeNull();
  });
});
