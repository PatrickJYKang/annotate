import { describe, expect, it } from 'vitest';
import defaultDocument from '../../public/tagging/board.json';
import legacyDocument from '../../e2e/fixtures/clip-editor-project/tagging-board.json';
import type { Locale } from '../i18n';
import { findBoardButton, parseTaggingBoard, validateTaggingBoard, type TaggingBoard } from './board';
import { createCaptureEngine } from './capture';
import labels from './defaultBoardLabels.json';
import { localizeDefaultTaggingBoard, upgradeDefaultBoardExclusions } from './localizedBoard';

const locales: Locale[] = ['en', ...Object.keys(labels) as Exclude<Locale, 'en'>[]];

function withoutLabels(board: TaggingBoard): unknown {
  return JSON.parse(JSON.stringify(board, (key, value) => key === 'label' ? undefined : value));
}

describe('built-in tagging board languages', () => {
  it('adds exclusions to exact older defaults in every language without modifying project data', () => {
    const previous = parseTaggingBoard(defaultDocument);
    delete previous.exclusiveGroups;
    for (const document of [previous, parseTaggingBoard(legacyDocument)]) {
      for (const locale of locales) {
        const localized = localizeDefaultTaggingBoard(document, locale);
        const original = structuredClone(localized);
        const upgraded = upgradeDefaultBoardExclusions(localized);
        expect(upgraded.exclusiveGroups).toEqual(defaultDocument.exclusiveGroups);
        expect(upgraded.groups).toEqual(original.groups);
        expect(localized).toEqual(original);
        expect(upgradeDefaultBoardExclusions(upgraded)).toBe(upgraded);
        expect(localizeDefaultTaggingBoard(upgraded, 'en').groups[0].label).toBe('Offensive - open play');
      }
    }
  });

  it('does not add rules to customized boards or override an explicit opt-out', () => {
    const custom = parseTaggingBoard(defaultDocument);
    delete custom.exclusiveGroups;
    custom.groups[0].buttons[0].label = 'Our possession';
    expect(upgradeDefaultBoardExclusions(custom)).toBe(custom);
    const optedOut = { ...parseTaggingBoard(defaultDocument), exclusiveGroups: [] };
    expect(upgradeDefaultBoardExclusions(optedOut)).toBe(optedOut);
  });

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
    let displayed = localizeDefaultTaggingBoard(board, 'es');
    const engine = createCaptureEngine({
      board, videoFrameCount: 1000, videoFps: 30, videoId: 'video',
      getButtonLabel: (id) => findBoardButton(displayed, id)?.label,
    });
    const id = 'offensive.open_play.possession';
    engine.pressButton(id, 10);
    engine.setRangeFacets(id, { 'zone.vertical_third': 'final_third' });
    const before = engine.getActiveRanges();
    displayed = localizeDefaultTaggingBoard(board, 'fr');
    displayed = localizeDefaultTaggingBoard(board, 'zh-CN');
    expect(engine.getActiveRanges()).toEqual(before);
    const result = engine.pressButton(id, 30);
    expect(result.kind).toBe('created');
    if (result.kind === 'created') {
      expect(result.clip.label).toBe(labels.es.Possession);
      expect(result.clip.generatedLabel).toBe(labels.es.Possession);
      expect(result.clip.tags).toEqual({ primary: id, facets: { 'zone.vertical_third': 'final_third' } });
      expect([result.clip.startFrame, result.clip.endFrame]).toEqual([10, 31]);
    }
    engine.pressButton(id, 40);
    expect(engine.pressButton(id, 50)).toMatchObject({
      kind: 'created', clip: { label: labels['zh-CN'].Possession, generatedLabel: labels['zh-CN'].Possession },
    });
  });

  it.each(locales)('captures the displayed %s name while keeping stable tag IDs', (locale) => {
    const board = parseTaggingBoard(defaultDocument);
    const displayed = localizeDefaultTaggingBoard(board, locale);
    const engine = createCaptureEngine({
      board, videoFrameCount: 1000, videoFps: 30, videoId: 'video',
      getButtonLabel: (id) => findBoardButton(displayed, id)?.label,
    });
    for (const id of ['offensive.open_play.possession', 'offensive.open_play.transition']) {
      const label = findBoardButton(displayed, id)!.label;
      expect(engine.pressButton(id, 10)).toMatchObject({ kind: 'armed', range: { buttonLabel: label } });
      expect(engine.pressButton(id, 20)).toMatchObject({
        kind: 'created', clip: { label, generatedLabel: label, tags: { primary: id } },
      });
    }
  });

  it('keeps the original name on an exclusive switch and uses the new language for its successor', async () => {
    const board = parseTaggingBoard(defaultDocument);
    let displayed = localizeDefaultTaggingBoard(board, 'es');
    const engine = createCaptureEngine({
      board, videoFrameCount: 1000, videoFps: 30, videoId: 'video',
      getButtonLabel: (id) => findBoardButton(displayed, id)?.label,
    });
    engine.pressButton('offensive.open_play.possession', 10);
    displayed = localizeDefaultTaggingBoard(board, 'zh-CN');
    const failed = engine.pressButtonAndPersist('defensive.open_play.possession', 20, async () => {
      throw new Error('disk full');
    });
    await expect(failed).rejects.toThrow('disk full');
    expect(engine.getActiveRanges()).toMatchObject([{ buttonLabel: labels.es.Possession }]);
    expect(engine.pressButton('defensive.open_play.possession', 20)).toMatchObject({
      kind: 'armed', range: { buttonLabel: labels['zh-CN'].Possession },
      closedClip: { label: labels.es.Possession, generatedLabel: labels.es.Possession },
    });
  });

  it('uses custom-board labels verbatim rather than translating matching default words', () => {
    const board = parseTaggingBoard(defaultDocument);
    board.groups[0].label = 'Our own board';
    const displayed = localizeDefaultTaggingBoard(board, 'es');
    const engine = createCaptureEngine({
      board, videoFrameCount: 1000, videoFps: 30, videoId: 'video',
      getButtonLabel: (id) => findBoardButton(displayed, id)?.label,
    });
    const id = 'offensive.open_play.possession';
    engine.pressButton(id, 0);
    expect(engine.pressButton(id, 0)).toMatchObject({
      kind: 'created', clip: { label: 'Possession', generatedLabel: 'Possession' },
    });
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
