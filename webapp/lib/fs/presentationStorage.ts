import type {
  Presentation,
  PresentationSlide,
  PresentationTransition,
  ClipSlide,
  TitleSlide,
  StillSlide,
} from '../types/presentation';
import { PRESENTATION_SCHEMA_VERSION } from '../types/presentation';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function getOrCreateDir(parent: FileSystemDirectoryHandle, name: string) {
  return await parent.getDirectoryHandle(name, { create: true });
}

function presentationFileName(presentationId: string): string {
  return `presentation-${presentationId}.json`;
}

function presentationIdFromFileName(name: string): string | null {
  const match = name.match(/^presentation-(.+)\.json$/);
  return match ? match[1] : null;
}

function normalizeTransitionLength(
  slides: PresentationSlide[],
  transitions: PresentationTransition[],
): PresentationTransition[] {
  const wanted = Math.max(0, slides.length - 1);
  if (transitions.length === wanted) return transitions;
  if (transitions.length > wanted) return transitions.slice(0, wanted);
  return [
    ...transitions,
    ...Array.from({ length: wanted - transitions.length }, () => ({ mode: 'cut' as const })),
  ];
}

function migrateStillSlide(raw: Record<string, unknown>): StillSlide {
  if (typeof raw.id !== 'string' || !raw.id) {
    throw new Error('Invalid presentation slide: missing id');
  }
  if (typeof raw.stillId !== 'string' || !raw.stillId) {
    throw new Error('Invalid still slide: missing stillId');
  }
  const annotationSetIdsRaw = raw.annotationSetIds;
  if (annotationSetIdsRaw != null && !Array.isArray(annotationSetIdsRaw)) {
    throw new Error('Invalid still slide: annotationSetIds must be an array');
  }
  const annotationSetCuesRaw = raw.annotationSetCues;
  if (annotationSetCuesRaw != null && !Array.isArray(annotationSetCuesRaw)) {
    throw new Error('Invalid still slide: annotationSetCues must be an array');
  }
  const annotationCuesRaw = raw.annotationCues;
  if (annotationCuesRaw != null && !Array.isArray(annotationCuesRaw)) {
    throw new Error('Invalid still slide: annotationCues must be an array');
  }
  return {
    id: raw.id,
    kind: 'still',
    stillId: raw.stillId,
    showAnnotations: typeof raw.showAnnotations === 'boolean' ? raw.showAnnotations : true,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
    holdMs: typeof raw.holdMs === 'number' ? raw.holdMs : undefined,
    annotationSetIds: Array.isArray(annotationSetIdsRaw)
      ? annotationSetIdsRaw.map((annotationSetId) => {
          if (typeof annotationSetId !== 'string' || !annotationSetId) {
            throw new Error('Invalid still slide: annotationSetIds must contain non-empty strings');
          }
          return annotationSetId;
        })
      : undefined,
    annotationSetCues: Array.isArray(annotationSetCuesRaw)
      ? annotationSetCuesRaw.map((cue) => {
          if (!isRecord(cue) || typeof cue.annotationSetId !== 'string' || !cue.annotationSetId) {
            throw new Error('Invalid still slide: annotation set cue missing annotationSetId');
          }
          return {
            annotationSetId: cue.annotationSetId,
            enterAtMs: typeof cue.enterAtMs === 'number' ? cue.enterAtMs : undefined,
            exitAtMs: typeof cue.exitAtMs === 'number' ? cue.exitAtMs : undefined,
          };
        })
      : undefined,
    annotationCues: Array.isArray(annotationCuesRaw)
      ? annotationCuesRaw.map((cue) => {
          if (!isRecord(cue) || typeof cue.annotationId !== 'string' || !cue.annotationId) {
            throw new Error('Invalid still slide: annotation cue missing annotationId');
          }
          return {
            annotationId: cue.annotationId,
            enterAtMs: typeof cue.enterAtMs === 'number' ? cue.enterAtMs : undefined,
            exitAtMs: typeof cue.exitAtMs === 'number' ? cue.exitAtMs : undefined,
          };
        })
      : undefined,
  };
}

function migrateTitleSlide(raw: Record<string, unknown>): TitleSlide {
  if (typeof raw.id !== 'string' || !raw.id) {
    throw new Error('Invalid presentation slide: missing id');
  }
  if (typeof raw.title !== 'string') {
    throw new Error('Invalid title slide: missing title');
  }
  if (raw.template !== 'title' && raw.template !== 'section' && raw.template !== 'divider') {
    throw new Error('Invalid title slide: unsupported template');
  }
  return {
    id: raw.id,
    kind: 'title',
    template: raw.template,
    title: raw.title,
    body: typeof raw.body === 'string' ? raw.body : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
    holdMs: typeof raw.holdMs === 'number' ? raw.holdMs : undefined,
  };
}

function migrateClipSlide(raw: Record<string, unknown>): ClipSlide {
  if (typeof raw.id !== 'string' || !raw.id) {
    throw new Error('Invalid presentation slide: missing id');
  }
  if (typeof raw.clipId !== 'string' || !raw.clipId) {
    throw new Error('Invalid clip slide: missing clipId');
  }
  return {
    id: raw.id,
    kind: 'clip',
    clipId: raw.clipId,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
    holdMs: typeof raw.holdMs === 'number' ? raw.holdMs : undefined,
  };
}

function migrateSlide(raw: unknown): PresentationSlide {
  if (!isRecord(raw)) {
    throw new Error('Invalid presentation slide: not an object');
  }
  if (raw.kind === 'still') return migrateStillSlide(raw);
  if (raw.kind === 'clip') return migrateClipSlide(raw);
  if (raw.kind === 'title') return migrateTitleSlide(raw);
  throw new Error('Invalid presentation slide: unknown kind');
}

function migrateTransition(raw: unknown): PresentationTransition {
  if (!isRecord(raw) || typeof raw.mode !== 'string') {
    throw new Error('Invalid presentation transition');
  }
  if (raw.mode === 'cut') {
    return { mode: 'cut' };
  }
  if (raw.mode === 'match_video') {
    return {
      mode: 'match_video',
      hideAnnotationsDuringPlayback:
        typeof raw.hideAnnotationsDuringPlayback === 'boolean'
          ? raw.hideAnnotationsDuringPlayback
          : true,
      playbackRate: typeof raw.playbackRate === 'number' ? raw.playbackRate : undefined,
      startOffsetMs: typeof raw.startOffsetMs === 'number' ? raw.startOffsetMs : undefined,
      endOffsetMs: typeof raw.endOffsetMs === 'number' ? raw.endOffsetMs : undefined,
    };
  }
  throw new Error('Invalid presentation transition mode');
}

export function migratePresentationSchema(raw: unknown): Presentation {
  if (!isRecord(raw)) {
    throw new Error('Invalid presentation data: not an object');
  }
  if (typeof raw.schema !== 'number') {
    throw new Error('Invalid presentation data: missing or invalid schema version');
  }
  if (raw.schema > PRESENTATION_SCHEMA_VERSION) {
    throw new Error(
      `Presentation schema version ${raw.schema} is newer than supported version ${PRESENTATION_SCHEMA_VERSION}. Please update the application.`,
    );
  }
  if (raw.schema !== 1) {
    throw new Error(`Unknown presentation schema version: ${raw.schema}`);
  }
  if (typeof raw.id !== 'string' || !raw.id) {
    throw new Error('Invalid presentation data: missing id');
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    throw new Error('Invalid presentation data: missing name');
  }
  if (typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') {
    throw new Error('Invalid presentation data: missing createdAt or updatedAt');
  }
  if (!Array.isArray(raw.slides)) {
    throw new Error('Invalid presentation data: slides must be an array');
  }
  if (raw.transitions != null && !Array.isArray(raw.transitions)) {
    throw new Error('Invalid presentation data: transitions must be an array');
  }

  const slides = raw.slides.map(migrateSlide);
  const transitions = normalizeTransitionLength(
    slides,
    (raw.transitions ?? []).map(migrateTransition),
  );

  const theme = isRecord(raw.theme)
    ? {
        background: typeof raw.theme.background === 'string' ? raw.theme.background : undefined,
        panelColor: typeof raw.theme.panelColor === 'string' ? raw.theme.panelColor : undefined,
        textColor: typeof raw.theme.textColor === 'string' ? raw.theme.textColor : undefined,
      }
    : undefined;

  return {
    schema: PRESENTATION_SCHEMA_VERSION,
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    slides,
    transitions,
    theme,
  };
}

export async function readPresentation(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
): Promise<Presentation | null> {
  let presentationsDir: FileSystemDirectoryHandle;
  try {
    presentationsDir = await projectDir.getDirectoryHandle('presentations', { create: false });
  } catch {
    return null;
  }

  let fh: FileSystemFileHandle;
  try {
    fh = await presentationsDir.getFileHandle(presentationFileName(presentationId), { create: false });
  } catch {
    return null;
  }

  const file = await fh.getFile();
  const text = await file.text();
  try {
    return migratePresentationSchema(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function writePresentation(
  projectDir: FileSystemDirectoryHandle,
  presentation: Presentation,
): Promise<void> {
  const normalized = migratePresentationSchema(presentation);
  const presentationsDir = await getOrCreateDir(projectDir, 'presentations');
  const fh = await presentationsDir.getFileHandle(presentationFileName(normalized.id), { create: true });
  const ws = await fh.createWritable();
  await ws.write(JSON.stringify(normalized, null, 2));
  await ws.close();
}

export async function deletePresentation(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
): Promise<void> {
  let presentationsDir: FileSystemDirectoryHandle;
  try {
    presentationsDir = await projectDir.getDirectoryHandle('presentations', { create: false });
  } catch {
    return;
  }

  try {
    await presentationsDir.removeEntry(presentationFileName(presentationId));
  } catch {
  }
}

export async function listPresentations(
  projectDir: FileSystemDirectoryHandle,
): Promise<Presentation[]> {
  let presentationsDir: FileSystemDirectoryHandle;
  try {
    presentationsDir = await projectDir.getDirectoryHandle('presentations', { create: false });
  } catch {
    return [];
  }

  const presentations: Presentation[] = [];
  for await (const [name, handle] of presentationsDir.entries()) {
    if ((handle as any).kind !== 'file') continue;
    if (!name.endsWith('.json')) continue;
    if (!presentationIdFromFileName(name)) continue;
    try {
      const file = await (handle as FileSystemFileHandle).getFile();
      const text = await file.text();
      presentations.push(migratePresentationSchema(JSON.parse(text)));
    } catch {
      console.warn(`Skipping invalid presentation file: ${name}`);
    }
  }

  presentations.sort((a, b) => {
    const updatedDiff = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (Number.isFinite(updatedDiff) && updatedDiff !== 0) return updatedDiff;
    const createdDiff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (Number.isFinite(createdDiff) && createdDiff !== 0) return createdDiff;
    return a.name.localeCompare(b.name);
  });
  return presentations;
}

export async function renamePresentation(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
  nextName: string,
  now = new Date(),
): Promise<Presentation | null> {
  const current = await readPresentation(projectDir, presentationId);
  if (!current) return null;
  const renamed = {
    ...current,
    name: nextName,
    updatedAt: now.toISOString(),
  };
  await writePresentation(projectDir, renamed);
  return renamed;
}

export async function duplicatePresentation(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
  nextId: string,
  nextName: string,
  now = new Date(),
): Promise<Presentation | null> {
  const current = await readPresentation(projectDir, presentationId);
  if (!current) return null;
  const duplicated = {
    ...current,
    id: nextId,
    name: nextName,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await writePresentation(projectDir, duplicated);
  return duplicated;
}
