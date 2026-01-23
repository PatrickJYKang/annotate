import { ProjectManifestV1, defaultProjectManifest } from '../types/project';

async function getOrCreateDir(parent: FileSystemDirectoryHandle, name: string) {
  return await parent.getDirectoryHandle(name, { create: true });
}

async function getFileHandle(dir: FileSystemDirectoryHandle, name: string, create = false) {
  try {
    return await dir.getFileHandle(name, { create });
  } catch (e) {
    if (!create) return null as any;
    throw e;
  }
}

export async function ensureProjectFolderStructure(projectDir: FileSystemDirectoryHandle, projectName?: string) {
  await getOrCreateDir(projectDir, 'media');
  await getOrCreateDir(projectDir, 'stills');
  await getOrCreateDir(projectDir, 'annotations');
  await getOrCreateDir(projectDir, 'thumbnails');
  await getOrCreateDir(projectDir, 'reports');
  await getOrCreateDir(projectDir, 'clips');
  const manifest = await ensureManifest(projectDir, projectName);
  return manifest;
}

export async function readManifest(projectDir: FileSystemDirectoryHandle): Promise<ProjectManifestV1 | null> {
  const fh = await getFileHandle(projectDir, 'project.json', false);
  if (!fh) return null;
  const file = await fh.getFile();
  const text = await file.text();
  try {
    const json = JSON.parse(text);
    if (json && json.schema === 'project.v1') return json as ProjectManifestV1;
    return null;
  } catch {
    return null;
  }
}

export async function validateProjectFolderStructure(projectDir: FileSystemDirectoryHandle): Promise<{ ok: true; manifest: ProjectManifestV1 } | { ok: false; reason: string }> {
  const mf = await readManifest(projectDir);
  if (!mf) return { ok: false, reason: 'Missing or invalid project.json' };

  const requiredDirs = ['media', 'stills', 'annotations', 'thumbnails', 'reports', 'clips'];
  for (const name of requiredDirs) {
    try {
      await projectDir.getDirectoryHandle(name, { create: false });
    } catch {
      return { ok: false, reason: `Missing required folder: ${name}/` };
    }
  }
  return { ok: true, manifest: mf };
}

export async function writeManifest(projectDir: FileSystemDirectoryHandle, manifest: ProjectManifestV1) {
  const fh = await getFileHandle(projectDir, 'project.json', true);
  const ws = await fh.createWritable();
  await ws.write(JSON.stringify(manifest, null, 2));
  await ws.close();
}

export async function reindexAnnotations(projectDir: FileSystemDirectoryHandle, manifest: ProjectManifestV1): Promise<ProjectManifestV1> {
  const stillIds = new Set((manifest.stills || []).map(s => s.id));
  let dir: FileSystemDirectoryHandle | null = null;
  try {
    dir = await projectDir.getDirectoryHandle('annotations', { create: true });
  } catch {
    dir = null;
  }
  if (!dir) return manifest;

  const nextAnn: ProjectManifestV1['annotations'] = [];
  try {
    for await (const [name, handle] of dir.entries()) {
      if (!name.toLowerCase().endsWith('.json')) continue;
      if ((handle as any).kind !== 'file') continue;
      const stillId = name.slice(0, -'.json'.length);
      if (!stillIds.has(stillId)) continue;
      let lastModified: string | undefined = undefined;
      try {
        const f = await (handle as FileSystemFileHandle).getFile();
        if (typeof f.lastModified === 'number' && Number.isFinite(f.lastModified)) {
          lastModified = new Date(f.lastModified).toISOString();
        }
      } catch {}
      nextAnn.push({ stillId, file: `annotations/${name}`, lastModified });
    }
  } catch {
    return manifest;
  }

  nextAnn.sort((a, b) => a.stillId.localeCompare(b.stillId));
  return { ...manifest, annotations: nextAnn };
}

async function ensureManifest(projectDir: FileSystemDirectoryHandle, projectName?: string): Promise<ProjectManifestV1> {
  const existing = await readManifest(projectDir);
  if (existing) return existing;
  const name = projectName || projectDir.name.replace(/\.matchproj$/i, '');
  const mf = defaultProjectManifest(name || 'Untitled Project');
  await writeManifest(projectDir, mf);
  return mf;
}
