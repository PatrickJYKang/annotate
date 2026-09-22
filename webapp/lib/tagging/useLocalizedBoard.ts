'use client';

import { useMemo } from 'react';
import { useLocale } from '../i18n';
import type { TaggingBoard } from './board';
import { localizeDefaultTaggingBoard } from './localizedBoard';

export function useLocalizedBoard(board: TaggingBoard): TaggingBoard;
export function useLocalizedBoard(board: TaggingBoard | null): TaggingBoard | null;
export function useLocalizedBoard(board: TaggingBoard | null): TaggingBoard | null {
  const { locale } = useLocale();
  return useMemo(() => localizeDefaultTaggingBoard(board, locale), [board, locale]);
}
