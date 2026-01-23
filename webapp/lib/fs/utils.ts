export async function uniqueFileName(dir: FileSystemDirectoryHandle, originalName: string): Promise<string> {
  const dot = originalName.lastIndexOf('.');
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  const ext = dot > 0 ? originalName.slice(dot) : '';

  let candidate = originalName;
  let index = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists = await fileExists(dir, candidate);
    if (!exists) return candidate;
    index += 1;
    candidate = `${base} (${index})${ext}`;
  }
}

export async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch (e: any) {
    if (e?.name === 'NotFoundError') return false;
    // If permission or other error, rethrow
    throw e;
  }
}
