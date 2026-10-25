import type { Locale } from './i18n';

// The user guide is published separately (GitHub Pages, repository PatrickJYKang/annotate-docs)
// in every UI language; the header's User guide button opens it.
export const ONLINE_GUIDE = 'https://patrickjykang.github.io/annotate-docs/';

export function onlineGuideUrl(locale: Locale): string {
  // The bare homepage detects browser language; an app choice must take precedence.
  return locale === 'en' ? `${ONLINE_GUIDE}?lang=en` : `${ONLINE_GUIDE}${locale}/`;
}
