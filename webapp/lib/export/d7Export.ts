import type { ProjectManifestV1 } from '../types/project';
import { writeManifest } from '../fs/projectFolder';
import type { AnnotationsV1, ExportShape } from './d7Render';
import { renderAnnotatedPng } from './d7Render';

type ExportRow = {
  videoId: string;
  videoLabel: string;
  stillId: string;
  stillFile: string;
  t_ms: number;
  t_hms: string;
  tags: string[];
  annotationTotal: number;
  annotationByType: Record<string, number>;
  annotatedFile: string;
};

export async function exportD7All(args: {
  projectDir: FileSystemDirectoryHandle;
  manifest: ProjectManifestV1;
  onProgress?: (p: { done: number; total: number; message: string }) => void;
}): Promise<{ manifest: ProjectManifestV1; failures: { stillId: string; error: string }[] }> {
  const { projectDir, manifest, onProgress } = args;

  await ensureWritePermission(projectDir);

  await ensureDir(projectDir, 'reports');
  await ensureDir(projectDir, 'reports/annotated');

  const stills = (manifest.stills || []).slice().sort((a, b) => (a.t_ms || 0) - (b.t_ms || 0));
  const total = stills.length;
  const rows: ExportRow[] = [];
  const failures: { stillId: string; error: string }[] = [];

  for (let i = 0; i < stills.length; i++) {
    const st = stills[i];
    onProgress?.({ done: i, total, message: `Exporting ${i + 1}/${total}: ${baseName(st.file)}` });

    try {
      const stillFile = await readFileFromPath(projectDir, st.file);
      const bmp = await createImageBitmap(stillFile);
      try {
        const ann = await readAnnotations(projectDir, st.id, st.file, bmp.width, bmp.height);
        const outName = baseName(st.file);
        const annotatedPath = `reports/annotated/${outName}`;
        const blob = await renderAnnotatedPng({ bmp, ann });
        await writeBlobToPath(projectDir, annotatedPath, blob);

        const { tags, videoLabel } = findTagsAndVideoLabel(manifest, st.videoId, st.t_ms);
        const counts = countAnnotations(ann.shapes || []);

        rows.push({
          videoId: st.videoId,
          videoLabel,
          stillId: st.id,
          stillFile: st.file,
          t_ms: st.t_ms,
          t_hms: formatTimeHms(st.t_ms || 0),
          tags,
          annotationTotal: counts.total,
          annotationByType: counts.byType,
          annotatedFile: annotatedPath,
        });
      } finally {
        try { bmp.close(); } catch {}
      }
    } catch (e: any) {
      failures.push({ stillId: st.id, error: e?.message || String(e) });
    }
  }

  onProgress?.({ done: total, total, message: 'Writing reports…' });

  const marksJsonPath = 'reports/marks.json';
  const marksCsvPath = 'reports/marks.csv';
  const annotationsJsonPath = 'reports/annotations.json';

  await writeTextToPath(projectDir, marksJsonPath, JSON.stringify(rows, null, 2), 'application/json');
  await writeTextToPath(projectDir, marksCsvPath, rowsToCsv(rows), 'text/csv');
  await writeTextToPath(projectDir, annotationsJsonPath, JSON.stringify(rows.map(r => ({ stillId: r.stillId, annotationTotal: r.annotationTotal, annotationByType: r.annotationByType })), null, 2), 'application/json');

  const reportSet = new Set((manifest.reports || []).slice());
  reportSet.add(marksJsonPath);
  reportSet.add(marksCsvPath);
  reportSet.add(annotationsJsonPath);

  const next: ProjectManifestV1 = { ...manifest, reports: Array.from(reportSet).sort() };
  await writeManifest(projectDir, next);

  onProgress?.({ done: total, total, message: failures.length ? `Export complete (${failures.length} failed)` : 'Export complete' });
  return { manifest: next, failures };
}

async function ensureWritePermission(dir: FileSystemDirectoryHandle) {
  const anyHandle: any = dir as any;
  const q = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'readwrite' }) : 'granted');
  if (q === 'granted') return;
  if (anyHandle?.requestPermission) {
    const r = await anyHandle.requestPermission({ mode: 'readwrite' });
    if (r === 'granted') return;
  }
  throw new Error('Write permission not granted');
}

function baseName(p: string) {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}

async function ensureDir(root: FileSystemDirectoryHandle, path: string) {
  const parts = path.split('/').filter(Boolean);
  let cur = root;
  for (const p of parts) cur = await cur.getDirectoryHandle(p, { create: true });
  return cur;
}

async function getFileHandleFromPath(root: FileSystemDirectoryHandle, path: string, create: boolean) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) throw new Error('Invalid path');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) cur = await cur.getDirectoryHandle(parts[i], { create });
  return await cur.getFileHandle(parts[parts.length - 1], { create });
}

async function readFileFromPath(root: FileSystemDirectoryHandle, path: string): Promise<File> {
  const fh = await getFileHandleFromPath(root, path, false);
  return await fh.getFile();
}

async function writeBlobToPath(root: FileSystemDirectoryHandle, path: string, blob: Blob) {
  const fh = await getFileHandleFromPath(root, path, true);
  const ws = await fh.createWritable();
  await ws.write(blob);
  await ws.close();
}

async function writeTextToPath(root: FileSystemDirectoryHandle, path: string, text: string, mime: string) {
  const fh = await getFileHandleFromPath(root, path, true);
  const ws = await fh.createWritable();
  await ws.write(new Blob([text], { type: mime }));
  await ws.close();
}

async function readAnnotations(root: FileSystemDirectoryHandle, stillId: string, stillFilePath: string, width: number, height: number): Promise<AnnotationsV1> {
  const path = `annotations/${stillId}.json`;
  try {
    const fh = await getFileHandleFromPath(root, path, false);
    const file = await fh.getFile();
    const text = await file.text();
    const json = JSON.parse(text);
    if (json && json.schema === 'annotations.v1' && Array.isArray(json.shapes)) return json as AnnotationsV1;
  } catch (e: any) {
    if (e?.name !== 'NotFoundError') {
      // ignore
    }
  }
  return { schema: 'annotations.v1', stillId, image: { file: stillFilePath, width, height }, shapes: [] as ExportShape[] };
}

function countAnnotations(shapes: ExportShape[]) {
  const byType: Record<string, number> = {};
  let total = 0;
  for (const s of shapes || []) {
    if ((s as any)?._temp) continue;
    total += 1;
    byType[s.type] = (byType[s.type] || 0) + 1;
  }
  return { total, byType };
}

function findTagsAndVideoLabel(manifest: ProjectManifestV1, videoId: string, t_ms: number) {
  const video = (manifest.videos || []).find(v => v.id === videoId);
  const fps = video?.fps || 30;
  const tolMs = Math.round((1000 / (fps || 30)) * 2);
  let best: { t_ms: number; tags: string[] } | null = null;
  for (const m of manifest.marks || []) {
    if (m.videoId !== videoId) continue;
    const d = Math.abs((m.t_ms || 0) - (t_ms || 0));
    if (d <= tolMs && (!best || d < Math.abs(best.t_ms - t_ms))) best = { t_ms: m.t_ms, tags: m.tags };
  }
  return { tags: best?.tags || [], videoLabel: video?.label || '' };
}

function formatTimeHms(ms: number) {
  const clamped = Math.max(0, Math.floor(ms || 0));
  let r = clamped;
  const hh = Math.floor(r / 3600000); r %= 3600000;
  const mm = Math.floor(r / 60000); r %= 60000;
  const ss = Math.floor(r / 1000);
  const ms0 = r % 1000;
  const base = hh > 0 ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
  return `${base}.${String(ms0).padStart(3, '0')}`;
}

function rowsToCsv(rows: ExportRow[]) {
  const header = ['videoId', 'videoLabel', 'stillId', 'stillFile', 't_ms', 't_hms', 'tags', 'annotationTotal', 'annotationByType', 'annotatedFile'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const row = [
      r.videoId,
      r.videoLabel,
      r.stillId,
      r.stillFile,
      String(r.t_ms),
      r.t_hms,
      (r.tags || []).join('|'),
      String(r.annotationTotal),
      JSON.stringify(r.annotationByType || {}),
      r.annotatedFile,
    ].map(csvCell);
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

function csvCell(v: string) {
  const s = String(v ?? '');
  if (/[\",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
