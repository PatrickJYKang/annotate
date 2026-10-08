import type { Locale } from '../../lib/i18n';
import type { TutorialId } from './content/types';

// The tutorial recordings stream from the online user guide (GitHub Pages, repository
// PatrickJYKang/annotate-docs), which also hosts the complete-workflow video. Every tutorial exists
// in every UI language. The recordings are not bundled with the app; masters live outside the
// repository (see docs/demo-recording-handoff.md).
export const ONLINE_GUIDE = 'https://patrickjykang.github.io/annotate-docs/';

export function tutorialVideo(id: TutorialId, locale: Locale) {
  const base = `${ONLINE_GUIDE}videos/${locale}/${id}`;
  return { src: `${base}.mp4`, poster: `${base}.jpg` };
}
