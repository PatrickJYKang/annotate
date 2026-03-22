import type { AnnotationsV1, ExportShape } from '../export/d7Render';
import type { ProjectAnnotationIndexEntry, ProjectManifestV1 } from '../types/project';

export interface ResolvedAnnotationEntry extends ProjectAnnotationIndexEntry {
  id: string;
  role: 'default' | 'alternate';
}

export interface LoadedAnnotationDocument {
  entry: ResolvedAnnotationEntry;
  document: AnnotationsV1;
}

function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function stripJsonSuffix(name: string): string {
  return name.toLowerCase().endsWith('.json') ? name.slice(0, -'.json'.length) : name;
}

async function getFileForPath(dir: FileSystemDirectoryHandle, path: string) {
  const parts = splitPath(path);
  let current = dir;
  for (let i = 0; i < parts.length - 1; i += 1) {
    current = await current.getDirectoryHandle(parts[i], { create: false });
  }
  const handle = await current.getFileHandle(parts[parts.length - 1], { create: false });
  return await handle.getFile();
}

async function getFileHandleForPath(dir: FileSystemDirectoryHandle, path: string, create: boolean) {
  const parts = splitPath(path);
  let current = dir;
  for (let i = 0; i < parts.length - 1; i += 1) {
    current = await current.getDirectoryHandle(parts[i], { create });
  }
  return await current.getFileHandle(parts[parts.length - 1], { create });
}

export function buildDefaultAnnotationPath(stillId: string): string {
  return `annotations/${stillId}.json`;
}

export function buildAnnotationPath(stillId: string, annotationId = 'default'): string {
  if (!annotationId || annotationId === 'default') {
    return buildDefaultAnnotationPath(stillId);
  }
  return `annotations/${stillId}/${annotationId}.json`;
}

export function deriveAnnotationStillId(path: string): string | null {
  const parts = splitPath(path);
  if (parts.length === 2 && parts[0] === 'annotations') {
    return stripJsonSuffix(parts[1]);
  }
  if (parts.length >= 3 && parts[0] === 'annotations') {
    return parts[1] || null;
  }
  return null;
}

export function deriveAnnotationEntryId(path: string): string {
  const parts = splitPath(path);
  if (parts.length === 2 && parts[0] === 'annotations') {
    return 'default';
  }
  if (parts.length >= 3 && parts[0] === 'annotations') {
    return stripJsonSuffix(parts.slice(2).join('/')) || 'default';
  }
  return 'default';
}

export function resolveAnnotationEntryId(entry: Pick<ProjectAnnotationIndexEntry, 'id' | 'file'>): string {
  return entry.id || deriveAnnotationEntryId(entry.file);
}

export function resolveAnnotationEntryRole(entry: Pick<ProjectAnnotationIndexEntry, 'id' | 'file' | 'role'>): 'default' | 'alternate' {
  if (entry.role === 'default' || entry.role === 'alternate') {
    return entry.role;
  }
  return resolveAnnotationEntryId(entry) === 'default' ? 'default' : 'alternate';
}

export function resolveAnnotationEntry(entry: ProjectAnnotationIndexEntry): ResolvedAnnotationEntry {
  return {
    ...entry,
    id: resolveAnnotationEntryId(entry),
    role: resolveAnnotationEntryRole(entry),
  };
}

export function sortAnnotationEntries(entries: ProjectAnnotationIndexEntry[]): ProjectAnnotationIndexEntry[] {
  return entries.slice().sort((a, b) => {
    const roleDelta = Number(resolveAnnotationEntryRole(a) !== 'default') - Number(resolveAnnotationEntryRole(b) !== 'default');
    if (roleDelta !== 0) return roleDelta;
    const stillDelta = a.stillId.localeCompare(b.stillId);
    if (stillDelta !== 0) return stillDelta;
    const labelA = a.label || '';
    const labelB = b.label || '';
    const labelDelta = labelA.localeCompare(labelB);
    if (labelDelta !== 0) return labelDelta;
    return a.file.localeCompare(b.file);
  });
}

export function listAnnotationEntriesForStill(manifest: ProjectManifestV1, stillId: string): ProjectAnnotationIndexEntry[] {
  return sortAnnotationEntries((manifest.annotations || []).filter((entry) => entry.stillId === stillId));
}

export function listAnnotationEntriesForStillWithDefault(manifest: ProjectManifestV1, stillId: string): ResolvedAnnotationEntry[] {
  const indexed = listAnnotationEntriesForStill(manifest, stillId).map(resolveAnnotationEntry);
  if (indexed.some((entry) => entry.id === 'default')) {
    return indexed;
  }
  return [
    resolveAnnotationEntry({
      stillId,
      id: 'default',
      file: buildDefaultAnnotationPath(stillId),
      role: 'default',
      label: 'Default annotations',
    }),
    ...indexed,
  ];
}

export function getPrimaryAnnotationEntry(manifest: ProjectManifestV1, stillId: string): ProjectAnnotationIndexEntry | null {
  const entries = listAnnotationEntriesForStill(manifest, stillId);
  return entries[0] ?? null;
}

export function createEmptyAnnotations(still: {
  id: string;
  file: string;
  width?: number;
  height?: number;
}, annotationId = 'default'): AnnotationsV1 {
  return {
    schema: 'annotations.v1',
    annotationId,
    stillId: still.id,
    image: {
      file: still.file,
      width: still.width ?? 0,
      height: still.height ?? 0,
    },
    shapes: [] as ExportShape[],
  };
}

export async function readAnnotationDocument(
  projectDir: FileSystemDirectoryHandle,
  filePath: string,
): Promise<AnnotationsV1 | null> {
  try {
    const file = await getFileForPath(projectDir, filePath);
    const text = await file.text();
    const json = JSON.parse(text);
    if (json && json.schema === 'annotations.v1' && Array.isArray(json.shapes)) {
      return json as AnnotationsV1;
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeAnnotationDocument(
  projectDir: FileSystemDirectoryHandle,
  filePath: string,
  document: AnnotationsV1,
) {
  const handle = await getFileHandleForPath(projectDir, filePath, true);
  const writable = await handle.createWritable();
  await writable.write(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
  await writable.close();
}

export async function deleteAnnotationDocument(projectDir: FileSystemDirectoryHandle, filePath: string) {
  const parts = splitPath(filePath);
  if (parts.length === 0) return;
  let current = projectDir;
  for (let i = 0; i < parts.length - 1; i += 1) {
    current = await current.getDirectoryHandle(parts[i], { create: false });
  }
  await current.removeEntry(parts[parts.length - 1]);
}

export function mergeAnnotationDocuments(documents: AnnotationsV1[]): AnnotationsV1 | null {
  if (documents.length === 0) return null;
  const base = documents[0];
  const seenShapeIds = new Set<string>();
  const shapes: ExportShape[] = [];
  let perspective: AnnotationsV1['perspective'] | undefined = undefined;
  for (const document of documents) {
    if (!perspective && document.perspective?.quad?.length === 4) {
      perspective = document.perspective;
    }
    for (const shape of document.shapes || []) {
      if ((shape as any)?._temp) continue;
      if (typeof shape.id === 'string' && shape.id.startsWith('_temp_')) continue;
      if (shape.id && seenShapeIds.has(shape.id)) continue;
      if (shape.id) seenShapeIds.add(shape.id);
      shapes.push(shape);
    }
  }
  return {
    schema: 'annotations.v1',
    annotationId: 'merged',
    stillId: base.stillId,
    image: base.image,
    shapes,
    perspective,
  };
}

export function mergeLoadedAnnotationDocuments(documents: LoadedAnnotationDocument[]): AnnotationsV1 | null {
  return mergeAnnotationDocuments(documents.map((entry) => entry.document));
}

export async function readAnnotationDocumentsForStill(
  projectDir: FileSystemDirectoryHandle,
  manifest: ProjectManifestV1,
  still: ProjectManifestV1['stills'][number],
): Promise<LoadedAnnotationDocument[]> {
  const entries = listAnnotationEntriesForStillWithDefault(manifest, still.id);
  const documents: LoadedAnnotationDocument[] = [];
  for (const entry of entries) {
    const document = await readAnnotationDocument(projectDir, entry.file);
    if (!document) continue;
    documents.push({
      entry,
      document: {
        ...document,
        annotationId: document.annotationId || entry.id,
        label: document.label || entry.label,
      },
    });
  }
  return documents;
}

export async function readMergedAnnotationsForStill(
  projectDir: FileSystemDirectoryHandle,
  manifest: ProjectManifestV1,
  still: ProjectManifestV1['stills'][number],
): Promise<AnnotationsV1 | null> {
  const documents = await readAnnotationDocumentsForStill(projectDir, manifest, still);
  return mergeLoadedAnnotationDocuments(documents);
}

async function walkAnnotationFiles(
  dir: FileSystemDirectoryHandle,
  prefix: string,
): Promise<string[]> {
  const files: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    const nextPath = `${prefix}/${name}`;
    if ((handle as any).kind === 'directory') {
      files.push(...await walkAnnotationFiles(handle as FileSystemDirectoryHandle, nextPath));
      continue;
    }
    if ((handle as any).kind === 'file' && name.toLowerCase().endsWith('.json')) {
      files.push(nextPath);
    }
  }
  return files;
}

export async function scanAnnotationEntries(
  projectDir: FileSystemDirectoryHandle,
  manifest: ProjectManifestV1,
): Promise<ProjectAnnotationIndexEntry[]> {
  const stillIds = new Set((manifest.stills || []).map((still) => still.id));
  let dir: FileSystemDirectoryHandle | null = null;
  try {
    dir = await projectDir.getDirectoryHandle('annotations', { create: true });
  } catch {
    dir = null;
  }
  if (!dir) return [];
  const paths = await walkAnnotationFiles(dir, 'annotations');
  const entries: ProjectAnnotationIndexEntry[] = [];
  for (const path of paths) {
    const stillId = deriveAnnotationStillId(path);
    if (!stillId || !stillIds.has(stillId)) continue;
    let lastModified: string | undefined = undefined;
    let label: string | undefined = undefined;
    let id: string | undefined = undefined;
    try {
      const file = await getFileForPath(projectDir, path);
      if (typeof file.lastModified === 'number' && Number.isFinite(file.lastModified)) {
        lastModified = new Date(file.lastModified).toISOString();
      }
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        if (json && json.schema === 'annotations.v1') {
          label = typeof json.label === 'string' && json.label ? json.label : undefined;
          id = typeof json.annotationId === 'string' && json.annotationId ? json.annotationId : undefined;
        }
      } catch {}
    } catch {}
    const resolvedId = id || deriveAnnotationEntryId(path);
    entries.push({
      id: resolvedId,
      stillId,
      file: path,
      role: resolvedId === 'default' ? 'default' : 'alternate',
      label,
      lastModified,
    });
  }
  return sortAnnotationEntries(entries);
}
