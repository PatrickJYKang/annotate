export const PRESENTATION_SCHEMA_VERSION = 1;

export type PresentationSlideId = string;

export type StillSlideAnnotationCue = {
  annotationId: string;
  enterAtMs?: number;
  exitAtMs?: number;
};

export type StillSlideAnnotationSetCue = {
  annotationSetId: string;
  enterAtMs?: number;
  exitAtMs?: number;
};

export type PresentationTransition =
  | {
      mode: 'cut';
    }
  | {
      mode: 'match_video';
      hideAnnotationsDuringPlayback: boolean;
      playbackRate?: number;
      startOffsetMs?: number;
      endOffsetMs?: number;
    };

export type StillSlide = {
  id: PresentationSlideId;
  kind: 'still';
  stillId: string;
  showAnnotations: boolean;
  notes?: string;
  holdMs?: number;
  annotationSetIds?: string[];
  annotationSetCues?: StillSlideAnnotationSetCue[];
  annotationCues?: StillSlideAnnotationCue[];
};

export type ClipSlide = {
  id: PresentationSlideId;
  kind: 'clip';
  clipId: string;
  notes?: string;
  holdMs?: number;
};

export type TitleSlide = {
  id: PresentationSlideId;
  kind: 'title';
  template: 'title' | 'section' | 'divider';
  title: string;
  body?: string;
  notes?: string;
  holdMs?: number;
};

export type PresentationSlide = StillSlide | ClipSlide | TitleSlide;

export interface PresentationTheme {
  background?: string;
  panelColor?: string;
  textColor?: string;
}

export interface Presentation {
  schema: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  slides: PresentationSlide[];
  transitions: PresentationTransition[];
  theme?: PresentationTheme;
}

export function createDefaultPresentation(name: string, id: string, now = new Date()): Presentation {
  const iso = now.toISOString();
  return {
    schema: PRESENTATION_SCHEMA_VERSION,
    id,
    name,
    createdAt: iso,
    updatedAt: iso,
    slides: [],
    transitions: [],
  };
}
