// ---------------------------------------------------------------------------
// Quick-annotate session helpers — a single uploaded image annotated without
// a project. Annotation documents persist in the origin-private file system
// (OPFS), keyed by the image file's identity, so re-opening the same image
// restores its annotations. The image itself stays in memory.
// ---------------------------------------------------------------------------

const QUICK_ROOT_DIR = 'quick-annotate';

// In-memory handoff from the splash screen to /quick-annotate. Survives a
// client-side route push (module singleton) but intentionally not a reload —
// the quick-annotate page offers its own picker for that case.
let stashedFile: File | null = null;

export function stashQuickAnnotateFile(file: File): void {
  stashedFile = file;
}

export function takeQuickAnnotateFile(): File | null {
  const file = stashedFile;
  stashedFile = null;
  return file;
}

export function isQuickAnnotateSupported(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.storage
    && typeof navigator.storage.getDirectory === 'function';
}

/** OPFS directory that backs quick-annotate sessions (created on demand). */
export async function getQuickAnnotateDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(QUICK_ROOT_DIR, { create: true });
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/** Deterministic still id for an uploaded file, so the same image maps to the same annotation document. */
export function quickStillIdForFile(file: File): string {
  return `quick_${hashString(`${file.name}|${file.size}|${file.lastModified}`)}`;
}

export function quickExportFileName(file: File): string {
  const dot = file.name.lastIndexOf('.');
  const base = dot > 0 ? file.name.slice(0, dot) : file.name;
  return `${base || 'still'}-annotated.png`;
}
