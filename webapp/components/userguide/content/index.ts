import type { Locale } from '../../../lib/i18n';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import type { GuideContent } from './types';
import { zhCN } from './zh-CN';

const CONTENT: Record<Locale, GuideContent> = { en, fr, es, 'zh-CN': zhCN };

export function guideContent(locale: string): GuideContent {
  return CONTENT[locale as Locale] ?? en;
}
