import {
  parseAnnotationDocument,
  type AnnotationDocument,
} from '../annotate/documentPayload';

function splitPath(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Annotation path must be a safe project-relative file path.');
  }
  return parts;
}

async function getFileForPath(
  dir: FileSystemDirectoryHandle,
  path: string,
): Promise<File> {
  const parts = splitPath(path);
  let current = dir;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = await current.getDirectoryHandle(parts[index], { create: false });
  }
  const handle = await current.getFileHandle(parts[parts.length - 1], { create: false });
  return handle.getFile();
}

async function getFileHandleForPath(
  dir: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  const parts = splitPath(path);
  let current = dir;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = await current.getDirectoryHandle(parts[index], { create });
  }
  return current.getFileHandle(parts[parts.length - 1], { create });
}

// Quick annotate remains an independent annotations.v1 session by design.
export function buildAnnotationPath(stillId: string, annotationId = 'default'): string {
  if (!annotationId || annotationId === 'default') return `annotations/${stillId}.json`;
  return `annotations/${stillId}/${annotationId}.json`;
}

export async function readAnnotationDocument(
  projectDir: FileSystemDirectoryHandle,
  filePath: string,
): Promise<AnnotationDocument | null> {
  try {
    const file = await getFileForPath(projectDir, filePath);
    return parseAnnotationDocument(JSON.parse(await file.text())).document;
  } catch {
    return null;
  }
}

export async function writeAnnotationDocument(
  projectDir: FileSystemDirectoryHandle,
  filePath: string,
  document: AnnotationDocument,
): Promise<void> {
  const handle = await getFileHandleForPath(projectDir, filePath, true);
  const writable = await handle.createWritable();
  await writable.write(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
  await writable.close();
}

export async function deleteAnnotationDocument(
  projectDir: FileSystemDirectoryHandle,
  filePath: string,
): Promise<void> {
  const parts = splitPath(filePath);
  let current = projectDir;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = await current.getDirectoryHandle(parts[index], { create: false });
  }
  await current.removeEntry(parts[parts.length - 1]);
}
