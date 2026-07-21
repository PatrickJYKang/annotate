export type PresentationSlideId = string;

export interface PinAnnotationCue {
  annotationId: string;
  enterAtMs?: number;
  exitAtMs?: number;
}
export interface ClipPauseCue {
  pinId: string;
  holdMs?: number;
  annotationIds?: string[] | null;
  annotationCues?: PinAnnotationCue[];
}

export interface ClipSlide {
  id: PresentationSlideId;
  kind: 'clip';
  clipId: string;
  pausePins: string[] | null;
  pauseCues?: ClipPauseCue[];
  notes?: string;
  holdMs?: number;
}

export interface PinSlide {
  id: PresentationSlideId;
  kind: 'pin';
  clipId: string;
  pinId: string;
  showAnnotations: boolean;
  annotationIds?: string[] | null;
  annotationCues?: PinAnnotationCue[];
  notes?: string;
  holdMs?: number;
}

export interface TitleSlide {
  id: PresentationSlideId;
  kind: 'title';
  template: 'title' | 'section' | 'divider';
  title: string;
  body?: string;
  notes?: string;
  holdMs?: number;
}

export type PresentationSlide = ClipSlide | PinSlide | TitleSlide;

export type PresentationTransition =
  | { mode: 'cut' }
  | {
      mode: 'match_video';
      hideAnnotationsDuringPlayback: boolean;
      playbackRate?: number;
      startOffsetFrames?: number;
      endOffsetFrames?: number;
    };

export interface PresentationTheme {
  background?: string;
  panelColor?: string;
  textColor?: string;
}

export interface Presentation {
  schema: 2;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  slides: PresentationSlide[];
  transitions: PresentationTransition[];
  theme?: PresentationTheme;
}

export function createDefaultPresentation(
  name: string,
  id: string,
  now = new Date(),
): Presentation {
  const iso = now.toISOString();
  return {
    schema: 2,
    id,
    name,
    createdAt: iso,
    updatedAt: iso,
    slides: [],
    transitions: [],
  };
}
