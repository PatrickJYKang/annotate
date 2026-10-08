// User-guide content for one UI language. Prose strings use a small inline markup rendered by
// RichText: **bold** for UI labels, `code` for paths and file names, [text](url) for links.
// UI labels in bold must match that language's i18n catalog (webapp/lib/i18n/messages).

export type TutorialId =
  | 'first-project'
  | 'capture-tagging'
  | 'clip-editing'
  | 'clip-trimming'
  | 'basic-tracking'
  | 'tracking-correction'
  | 'tracking-refinements'
  | 'pin-annotation'
  | 'pin-animations'
  | 'homography'
  | 'presentation-authoring'
  | 'export-recovery';

export type GuideLink = {
  id: string;
  label: string;
  summary: string;
  keywords: string;
};

export type GuideGroup = {
  label: string;
  links: GuideLink[];
};

type TitledProse = { title: string; paragraphs: string[] };

export type GuideContent = {
  ui: {
    searchLabel: string;
    searchPlaceholder: string;
    navigationLabel: string;
    mobileNavigationLabel: string;
    browseSections: string;
    resultCount: (count: number) => string;
    noResults: string;
    onThisPage: string;
    video: string;
    videoOffline: string;
    result: string;
  };
  title: string;
  lede: string;
  groups: GuideGroup[];
  tutorials: Record<TutorialId, { title: string; description: string }>;
  overview: TitledProse & { cards: [string, string][] };
  videos: { title: string; intro: string };
  firstProject: {
    title: string;
    intro: string;
    steps: { title: string; location: string; action: string; result: string }[];
  };
  installation: TitledProse;
  capture: TitledProse;
  clipEditor: TitledProse & { trimTitle: string; trim: string; keyframeTitle: string; keyframeRules: string[] };
  tracking: { title: string; steps: string[]; correctTitle: string; correct: string[]; namesTitle: string; names: string[] };
  pins: TitledProse & { animateTitle: string; animate: string[] };
  homography: TitledProse;
  presentations: TitledProse;
  exportRecovery: TitledProse;
  workspaceMap: { title: string; headings: string[]; rows: string[][] };
  drawingTools: { title: string; headings: string[]; rows: string[][]; note: string };
  keyboard: { title: string; headings: string[]; rows: string[][]; note: string };
  glossary: { title: string; entries: [string, string][] };
  projectFiles: TitledProse;
  troubleshooting: { title: string; entries: [string, string][] };
  onThisPage: [string, string][];
};
