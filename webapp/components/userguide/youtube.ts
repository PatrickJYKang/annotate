import type { Locale } from '../../lib/i18n';
import type { TutorialId } from './content/types';

// YouTube video IDs for the guide tutorials, per UI language (the 11-character ID from
// youtube.com/watch?v=<ID>). The guide embeds the current language's recording, falls back to
// English, and shows a "coming soon" placeholder while no ID is set. The recordings themselves
// are not bundled with the app; masters live outside the repository (see
// docs/demo-recording-handoff.md).
export const YOUTUBE_VIDEOS: Record<TutorialId, Partial<Record<Locale, string>>> = {
  'first-project': {},
  'capture-tagging': {},
  'clip-editing': {},
  'clip-trimming': {},
  'basic-tracking': {},
  'tracking-correction': {},
  'tracking-refinements': {},
  'pin-annotation': {},
  'pin-animations': {},
  homography: {},
  'presentation-authoring': {},
  'export-recovery': {},
};
