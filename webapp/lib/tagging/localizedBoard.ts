import defaultDocument from '../../public/tagging/board.json';
import type { Locale } from '../i18n';
import { parseTaggingBoard, type TaggingBoard } from './board';
import labels from './defaultBoardLabels.json';

function translateBoard(board: TaggingBoard, locale: Locale): TaggingBoard {
  const catalog: Record<string, string> = locale === 'en' ? {} : labels[locale];
  const translate = (label: string) => catalog[label] ?? label;
  return {
    ...board,
    groups: board.groups.map((group) => ({
      ...group,
      label: translate(group.label),
      buttons: group.buttons.map((button) => ({ ...button, label: translate(button.label) })),
    })),
    facets: board.facets.map((facet) => ({
      ...facet,
      label: translate(facet.label),
      options: facet.options.map((option) => ({ ...option, label: translate(option.label) })),
    })),
  };
}

function fingerprint(board: TaggingBoard): string {
  return JSON.stringify(board, (_key, value: unknown) => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value
  ));
}

const currentDefault = parseTaggingBoard(defaultDocument);
// Earlier projects copied the same built-in vocabulary before explicit layout
// coordinates and range-only capture became the default.
const legacyDefault = structuredClone(currentDefault);
delete legacyDefault.layout;
legacyDefault.defaults = { leadSeconds: 3, lagSeconds: 3, mode: 'instant' };
legacyDefault.groups.forEach((group) => {
  delete group.labelRect;
  group.buttons.forEach((button) => { delete button.rect; });
});

const variants = [currentDefault, legacyDefault].map((board) => {
  const translations = {
    en: board,
    fr: translateBoard(board, 'fr'),
    es: translateBoard(board, 'es'),
    'zh-CN': translateBoard(board, 'zh-CN'),
  };
  return { translations, fingerprints: new Set(Object.values(translations).map(fingerprint)) };
});

export function localizeDefaultTaggingBoard(board: TaggingBoard, locale: Locale): TaggingBoard;
export function localizeDefaultTaggingBoard(board: TaggingBoard | null, locale: Locale): TaggingBoard | null;
export function localizeDefaultTaggingBoard(board: TaggingBoard | null, locale: Locale): TaggingBoard | null {
  if (!board) return null;
  const key = fingerprint(board);
  const variant = variants.find((candidate) => candidate.fingerprints.has(key));
  // IDs alone cannot identify a default: a custom board may reuse all of them.
  if (!variant || key === fingerprint(variant.translations[locale])) return board;
  return structuredClone(variant.translations[locale]);
}
