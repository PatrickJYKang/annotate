import type { ProjectManifestV1 } from '../types/project';
import type {
  Presentation,
  PresentationSlide,
  PresentationTransition,
  ClipSlide,
  StillSlide,
  TitleSlide,
} from '../types/presentation';
import type { TaggingNode, TaggingSchema } from '../tagging/schema';
import { ensureTaggingSelection } from '../tagging/schema';
import { findCanonicalStillForMark, findLinkedStillsForMark } from '../utils/projectIntegrity';

export type PresentationAssetMark = {
  mark: ProjectManifestV1['marks'][number];
  linkedStills: ProjectManifestV1['stills'];
  canonicalStill: ProjectManifestV1['stills'][number] | null;
};

export type PresentationAssetTreeNode = {
  id: string;
  label: string;
  marks: PresentationAssetMark[];
  children: PresentationAssetTreeNode[];
  markCount: number;
};

export type PresentationAssetIndex = {
  tree: PresentationAssetTreeNode[];
  untagged: PresentationAssetMark[];
  unknown: PresentationAssetMark[];
  missingSourceMark: ProjectManifestV1['stills'];
};

export type ChronologicalStillAsset = {
  still: ProjectManifestV1['stills'][number];
  sourceMark: ProjectManifestV1['marks'][number] | null;
  canonicalForSourceMark: boolean;
  primaryTag: string | null;
};

export type ChronologicalStillGroup = {
  videoId: string;
  videoLabel: string;
  stills: ChronologicalStillAsset[];
};

function randomId(prefix: string): string {
  return (globalThis.crypto && 'randomUUID' in globalThis.crypto)
    ? (globalThis.crypto as any).randomUUID()
    : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultTransitionForSlides(
  manifest: ProjectManifestV1,
  fromSlide: PresentationSlide,
  toSlide: PresentationSlide,
): PresentationTransition {
  if (fromSlide.kind !== 'still' || toSlide.kind !== 'still') {
    return { mode: 'cut' };
  }
  const fromStill = manifest.stills.find((still) => still.id === fromSlide.stillId);
  const toStill = manifest.stills.find((still) => still.id === toSlide.stillId);
  if (!fromStill || !toStill) {
    return { mode: 'cut' };
  }
  if (fromStill.videoId !== toStill.videoId) {
    return { mode: 'cut' };
  }
  if (toStill.t_ms <= fromStill.t_ms) {
    return { mode: 'cut' };
  }
  if (toStill.t_ms - fromStill.t_ms <= 5000) {
    return {
      mode: 'match_video',
      hideAnnotationsDuringPlayback: true,
    };
  }
  return { mode: 'cut' };
}

export function synchronizeTransitions(
  manifest: ProjectManifestV1,
  previousSlides: PresentationSlide[],
  nextSlides: PresentationSlide[],
  previousTransitions: PresentationTransition[],
): PresentationTransition[] {
  const previousByEdge = new Map<string, PresentationTransition>();
  for (let index = 0; index < previousSlides.length - 1; index += 1) {
    const from = previousSlides[index];
    const to = previousSlides[index + 1];
    const transition = previousTransitions[index];
    if (!from || !to || !transition) continue;
    previousByEdge.set(`${from.id}::${to.id}`, transition);
  }

  const nextTransitions: PresentationTransition[] = [];
  for (let index = 0; index < nextSlides.length - 1; index += 1) {
    const from = nextSlides[index];
    const to = nextSlides[index + 1];
    const preserved = previousByEdge.get(`${from.id}::${to.id}`);
    nextTransitions.push(preserved ?? defaultTransitionForSlides(manifest, from, to));
  }
  return nextTransitions;
}

export function createStillSlide(stillId: string): StillSlide {
  return {
    id: randomId('slide'),
    kind: 'still',
    stillId,
    showAnnotations: true,
    notes: '',
  };
}

export function createClipSlide(clipId: string): ClipSlide {
  return {
    id: randomId('slide'),
    kind: 'clip',
    clipId,
    notes: '',
  };
}

export function createTitleSlide(template: TitleSlide['template'] = 'title'): TitleSlide {
  return {
    id: randomId('slide'),
    kind: 'title',
    template,
    title: 'Untitled title slide',
    body: '',
    notes: '',
  };
}

export function withUpdatedPresentation(
  manifest: ProjectManifestV1,
  presentation: Presentation,
  nextSlides: PresentationSlide[],
  nextUpdatedAt = new Date().toISOString(),
): Presentation {
  return {
    ...presentation,
    slides: nextSlides,
    transitions: synchronizeTransitions(manifest, presentation.slides, nextSlides, presentation.transitions),
    updatedAt: nextUpdatedAt,
  };
}

function buildMarkAssets(manifest: ProjectManifestV1): PresentationAssetMark[] {
  return manifest.marks
    .slice()
    .sort((a, b) => {
      if (a.videoId !== b.videoId) return a.videoId.localeCompare(b.videoId);
      if (a.t_ms !== b.t_ms) return a.t_ms - b.t_ms;
      return a.id.localeCompare(b.id);
    })
    .map((mark) => ({
      mark,
      linkedStills: findLinkedStillsForMark(manifest.stills, mark.id),
      canonicalStill: findCanonicalStillForMark(manifest, mark.id),
    }));
}

function buildNodeMap(nodes: TaggingNode[], assetsByNodeId: Map<string, PresentationAssetMark[]>): PresentationAssetTreeNode[] {
  return nodes.map((node) => {
    const children = buildNodeMap(node.children ?? [], assetsByNodeId);
    const marks = assetsByNodeId.get(node.id) ?? [];
    const markCount = marks.length + children.reduce((sum, child) => sum + child.markCount, 0);
    return {
      id: node.id,
      label: node.label,
      marks,
      children,
      markCount,
    };
  });
}

export function buildPresentationAssetIndex(
  schema: TaggingSchema | null,
  manifest: ProjectManifestV1,
): PresentationAssetIndex {
  const assets = buildMarkAssets(manifest);
  const schemaNodeIds = new Set<string>();
  if (schema) {
    const stack = [...schema.primary_tree];
    while (stack.length > 0) {
      const node = stack.pop()!;
      schemaNodeIds.add(node.id);
      if (node.children?.length) stack.push(...node.children);
    }
  }

  const byNodeId = new Map<string, PresentationAssetMark[]>();
  const untagged: PresentationAssetMark[] = [];
  const unknown: PresentationAssetMark[] = [];

  for (const asset of assets) {
    const selection = ensureTaggingSelection(asset.mark.tags);
    const primary = selection.primary;
    if (!primary) {
      untagged.push(asset);
      continue;
    }
    if (!schema || !schemaNodeIds.has(primary)) {
      unknown.push(asset);
      continue;
    }
    const existing = byNodeId.get(primary);
    if (existing) existing.push(asset);
    else byNodeId.set(primary, [asset]);
  }

  const markIds = new Set(manifest.marks.map((mark) => mark.id));
  const missingSourceMark = manifest.stills.filter((still) => !still.sourceMarkId || !markIds.has(still.sourceMarkId));

  return {
    tree: schema ? buildNodeMap(schema.primary_tree, byNodeId) : [],
    untagged,
    unknown,
    missingSourceMark,
  };
}

export function buildChronologicalStillGroups(
  manifest: ProjectManifestV1,
): ChronologicalStillGroup[] {
  const markById = new Map(manifest.marks.map((mark) => [mark.id, mark] as const));
  const videoLabelById = new Map(manifest.videos.map((video) => [video.id, video.label] as const));
  const videoOrderById = new Map(manifest.videos.map((video, index) => [video.id, index] as const));
  const grouped = new Map<string, ChronologicalStillAsset[]>();

  for (const still of manifest.stills) {
    const sourceMark = still.sourceMarkId ? markById.get(still.sourceMarkId) ?? null : null;
    const selection = ensureTaggingSelection(sourceMark?.tags);
    const entry: ChronologicalStillAsset = {
      still,
      sourceMark,
      canonicalForSourceMark: sourceMark ? findCanonicalStillForMark(manifest, sourceMark.id)?.id === still.id : false,
      primaryTag: selection.primary || null,
    };
    const bucket = grouped.get(still.videoId);
    if (bucket) bucket.push(entry);
    else grouped.set(still.videoId, [entry]);
  }

  return Array.from(grouped.entries())
    .sort(([videoIdA], [videoIdB]) => {
      const orderA = videoOrderById.get(videoIdA) ?? Number.MAX_SAFE_INTEGER;
      const orderB = videoOrderById.get(videoIdB) ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return videoIdA.localeCompare(videoIdB);
    })
    .map(([videoId, stills]) => ({
      videoId,
      videoLabel: videoLabelById.get(videoId) || videoId,
      stills: stills.slice().sort((a, b) => {
        if (a.still.t_ms !== b.still.t_ms) return a.still.t_ms - b.still.t_ms;
        return a.still.id.localeCompare(b.still.id);
      }),
    }));
}

export function insertSlideAfterSelection(
  manifest: ProjectManifestV1,
  presentation: Presentation,
  selectedSlideIndex: number,
  slide: PresentationSlide,
): { presentation: Presentation; insertedIndex: number } {
  const insertIndex = selectedSlideIndex >= 0
    ? Math.min(presentation.slides.length, selectedSlideIndex + 1)
    : presentation.slides.length;
  const nextSlides = presentation.slides.slice();
  nextSlides.splice(insertIndex, 0, slide);
  return {
    presentation: withUpdatedPresentation(manifest, presentation, nextSlides),
    insertedIndex: insertIndex,
  };
}

export function removeSlideAtIndex(
  manifest: ProjectManifestV1,
  presentation: Presentation,
  slideIndex: number,
): Presentation {
  if (slideIndex < 0 || slideIndex >= presentation.slides.length) return presentation;
  const nextSlides = presentation.slides.filter((_, index) => index !== slideIndex);
  return withUpdatedPresentation(manifest, presentation, nextSlides);
}

export function moveSlide(
  manifest: ProjectManifestV1,
  presentation: Presentation,
  fromIndex: number,
  toIndex: number,
): Presentation {
  if (fromIndex === toIndex) return presentation;
  if (fromIndex < 0 || toIndex < 0) return presentation;
  if (fromIndex >= presentation.slides.length || toIndex >= presentation.slides.length) return presentation;
  const nextSlides = presentation.slides.slice();
  const [moved] = nextSlides.splice(fromIndex, 1);
  nextSlides.splice(toIndex, 0, moved);
  return withUpdatedPresentation(manifest, presentation, nextSlides);
}
