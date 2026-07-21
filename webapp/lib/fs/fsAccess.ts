export type FileInventoryEntry = {
  path: string;
  size: number;
};

export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')
  );
}

export function assertSafePathSegment(segment: string): void {
  if (
    !segment
    || segment === '.'
    || segment === '..'
    || segment.includes('/')
    || segment.includes('\\')
    || segment.includes('\0')
  ) {
    throw new Error(`Unsafe filesystem path segment: ${JSON.stringify(segment)}`);
  }
}

export function splitSafeRelativePath(path: string): string[] {
  if (!path || path.startsWith('/') || path.startsWith('\\') || path.includes('\\')) {
    throw new Error(`Unsafe relative path: ${JSON.stringify(path)}`);
  }
  const segments = path.split('/');
  segments.forEach(assertSafePathSegment);
  return segments;
}

export async function getDirectoryPath(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of segments) {
    assertSafePathSegment(segment);
    current = await current.getDirectoryHandle(segment, { create });
  }
  return current;
}

export async function getFilePath(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
  create = false,
): Promise<FileSystemFileHandle> {
  if (segments.length === 0) throw new Error('File path cannot be empty.');
  const parent = await getDirectoryPath(root, segments.slice(0, -1), create);
  const name = segments[segments.length - 1];
  assertSafePathSegment(name);
  return parent.getFileHandle(name, { create });
}

export async function readTextFile(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
): Promise<string> {
  const handle = await getFilePath(root, segments, false);
  return (await handle.getFile()).text();
}

export async function writeTextFile(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
  text: string,
): Promise<void> {
  const handle = await getFilePath(root, segments, true);
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function writeJsonFile(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
  value: unknown,
): Promise<void> {
  await writeTextFile(root, segments, JSON.stringify(value, null, 2));
}

export async function pathExists(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
  kind: 'file' | 'directory',
): Promise<boolean> {
  try {
    if (kind === 'file') await getFilePath(root, segments, false);
    else await getDirectoryPath(root, segments, false);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

export async function directoryIsEmpty(directory: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const _entry of directory.entries()) {
    return false;
  }
  return true;
}

export async function inventoryDirectory(
  directory: FileSystemDirectoryHandle,
  prefix = '',
): Promise<FileInventoryEntry[]> {
  const inventory: FileInventoryEntry[] = [];
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile();
      inventory.push({ path, size: file.size });
    } else {
      inventory.push(...await inventoryDirectory(handle as FileSystemDirectoryHandle, path));
    }
  }
  return inventory.sort((left, right) => left.path.localeCompare(right.path));
}

export async function copyDirectoryContents(
  source: FileSystemDirectoryHandle,
  destination: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const [name, handle] of source.entries()) {
    assertSafePathSegment(name);
    if (handle.kind === 'file') {
      const sourceFile = await (handle as FileSystemFileHandle).getFile();
      const destinationFile = await destination.getFileHandle(name, { create: true });
      const writable = await destinationFile.createWritable();
      await writable.write(sourceFile);
      await writable.close();
    } else {
      const destinationDirectory = await destination.getDirectoryHandle(name, { create: true });
      await copyDirectoryContents(handle as FileSystemDirectoryHandle, destinationDirectory);
    }
  }
}

export async function copyFileVerified(
  source: FileSystemFileHandle,
  destination: FileSystemFileHandle,
): Promise<number> {
  const sourceFile = await source.getFile();
  const writable = await destination.createWritable();
  await writable.write(sourceFile);
  await writable.close();
  const destinationFile = await destination.getFile();
  if (sourceFile.size !== destinationFile.size) {
    throw new Error(`File copy verification failed for "${source.name}".`);
  }
  return sourceFile.size;
}

export function inventoriesMatch(
  source: readonly FileInventoryEntry[],
  destination: readonly FileInventoryEntry[],
): boolean {
  if (source.length !== destination.length) return false;
  return source.every((entry, index) => (
    entry.path === destination[index]?.path && entry.size === destination[index]?.size
  ));
}

export async function removePath(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
  recursive = false,
): Promise<void> {
  if (segments.length === 0) throw new Error('Cannot remove the filesystem root.');
  const parent = await getDirectoryPath(root, segments.slice(0, -1), false);
  const name = segments[segments.length - 1];
  assertSafePathSegment(name);
  await parent.removeEntry(name, { recursive });
}
