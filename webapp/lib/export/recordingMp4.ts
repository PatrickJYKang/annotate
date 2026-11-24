import { sampleAnnotationAnimations } from '../annotate/animation';
import { annotationPayloadFromDocument } from '../annotate/documentPayload';
import { frameTemporalAdapter, renderClipAnnotationsToCanvas } from '../clip/renderClipAnnotations';
import { resolveUsableHomographyAtTime } from '../clip/homographyInterpolation';
import {
  cleanupExport,
  downloadExportFile,
  encodeExport,
  sendExportFrame,
  startExport,
} from '../clip/sidecarClient';
import { findOverlappingCache, type HomographyFrame } from '../fs/homographyCache';
import { getFilePath } from '../fs/fsAccess';
import { readPinAnnotationDocument } from '../fs/pinAnnotationStorage';
import type { ProjectDirectory } from '../host/contracts';
import { waitForMetadata, seekVideo } from '../media/frameRaster';
import { visibleAnnotationIds } from '../presentation/playback';
import type { Annotations } from '../types/annotations';
import type { TitleSlide } from '../types/presentation';
import { paintAnnotationPayloadToCanvas } from './d7Render';
import { outputFrames, type OutputSegment } from './recording';

function drawTitle(ctx: CanvasRenderingContext2D, slide: TitleSlide) {
  const { width: w, height: h } = ctx.canvas;
  const center = slide.template === 'section',
    divider = slide.template === 'divider';
  ctx.fillStyle = center ? '#101722' : '#0b1018';
  ctx.fillRect(0, 0, w, h);
  const x = center ? w / 2 : divider ? w * 0.38 : w * 0.12;
  if (divider) {
    ctx.fillStyle = '#dce5ee';
    ctx.fillRect(0, 0, w * 0.3, h);
  }
  ctx.save();
  ctx.textAlign = center ? 'center' : 'left';
  const maxWidth = w * (divider ? 0.55 : 0.76);
  const lines: Array<{ text: string; size: number; title: boolean }> = [];
  for (const [text, title] of [
    [slide.title, true],
    [slide.body ?? '', false],
  ] as const) {
    if (!text) continue;
    const size = w * (title ? 0.065 : 0.023);
    ctx.font = (title ? '600 ' : '') + size + 'px sans-serif';
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (line && ctx.measureText(line + ' ' + word).width > maxWidth) {
          lines.push({ text: line, size, title });
          line = '';
        }
        line += (line ? ' ' : '') + word;
      }
      lines.push({ text: line, size, title });
    }
  }
  const height = lines.reduce((sum, l) => sum + l.size * 1.2, 0);
  let y = center || divider ? (h - height) / 2 : h * 0.87 - height;
  ctx.fillStyle = '#67aaf0';
  if (center) ctx.fillRect(w * 0.46, y - h * 0.04, w * 0.08, 2);
  if (!center && !divider) ctx.fillRect(w * 0.09, y, 4, height);
  ctx.textBaseline = 'top';
  for (const line of lines) {
    ctx.font = (line.title ? '600 ' : '') + line.size + 'px sans-serif';
    ctx.fillStyle = line.title ? '#f1f4f7' : '#aab5c3';
    ctx.fillText(line.text, x, y, maxWidth);
    y += line.size * 1.2;
  }
  if (center) {
    ctx.fillStyle = '#67aaf0';
    ctx.fillRect(w * 0.46, y + h * 0.04, w * 0.08, 2);
  }
  ctx.restore();
}

export async function exportRecording(
  dir: ProjectDirectory,
  name: string,
  id: string,
  segments: OutputSegment[],
  urls: ReadonlyMap<string, { url: string }>,
  progress: (percent: number) => void,
  signal: AbortSignal,
) {
  const first = segments.find((s) => s.kind !== 'title');
  const fps = first?.video.fps ?? 30;
  const out = document.createElement('canvas'),
    overlay = document.createElement('canvas');
  out.width = 2 * Math.max(1, Math.round((first?.video.width ?? 1280) / 2));
  out.height = 2 * Math.max(1, Math.round((first?.video.height ?? 720) / 2));
  const ctx = out.getContext('2d')!;
  const count = Math.ceil((segments.reduce((sum, s) => sum + s.duration, 0) * fps) / 1000 - 1e-8);
  if (!count) throw new Error('Nothing to export.');
  const format = { clipId: id, width: out.width, height: out.height, fps };
  const { sessionId } = dir.command
    ? await dir.command<{ sessionId: string }>('recording.start', [format])
    : await startExport(format);
  const video = document.createElement('video');
  video.muted = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  let videoId = '',
    previous: OutputSegment | null = null;
  let homography: HomographyFrame[] = [];
  let docs: Annotations[] = [];
  try {
    for (const { index, segment: s, elapsed } of outputFrames(segments, fps)) {
      signal.throwIfAborted();
      if (s.kind === 'title') drawTitle(ctx, s.slide);
      else {
        if (videoId !== s.video.id) {
          const url = urls.get(s.video.id)?.url;
          if (!url) throw new Error('Source video unavailable: ' + s.video.label);
          video.src = url;
          videoId = s.video.id;
          await waitForMetadata(video);
          overlay.width = s.video.width;
          overlay.height = s.video.height;
        }
        const frame =
          s.kind === 'pin'
            ? s.pin.frame
            : Math.min(s.end - 1, s.start + Math.floor((elapsed * s.video.fps * s.rate) / 1000));
        await seekVideo(video, (frame + 0.25) / s.video.fps);
        const layer = overlay.getContext('2d')!;
        layer.clearRect(0, 0, overlay.width, overlay.height);
        if (s.kind === 'pin') {
          if (previous !== s) {
            docs = await Promise.all(
              s.pin.annotations
                .filter((a) => !s.ids || s.ids.includes(a.id))
                .map(async (ref) => {
                  const read = await readPinAnnotationDocument(dir, s.clip.id, ref.id);
                  if (!read.document) throw new Error(read.error ?? 'Missing pin annotation.');
                  return read.document;
                }),
            );
          }
          const visible = visibleAnnotationIds(
            docs.map((d) => d.annotationId),
            s.ids,
            s.cues,
            elapsed,
          );
          for (const doc of docs.filter((d) => visible.includes(d.annotationId))) {
            const enter = s.cues?.find((c) => c.annotationId === doc.annotationId)?.enterAtMs ?? 0;
            paintAnnotationPayloadToCanvas({
              context: layer,
              payload: annotationPayloadFromDocument(doc),
              visuals: sampleAnnotationAnimations(
                doc.animations,
                elapsed - enter,
                s.clicks.filter((t) => t >= enter).map((t) => t - enter),
              ),
            });
          }
        } else if (s.clip) {
          if (previous !== s)
            homography =
              (await findOverlappingCache(
                dir,
                s.video.id,
                (s.clip.startFrame * 1000) / s.video.fps,
                ((s.clip.endFrame - 1) * 1000) / s.video.fps,
              )) ?? [];
          renderClipAnnotationsToCanvas({
            canvas: overlay,
            annotations: s.clip.annotations,
            sample: frame,
            temporalAdapter: frameTemporalAdapter(s.clip.endFrame),
            homographyLookup: (f) => resolveUsableHomographyAtTime(homography, (f * 1000) / s.video.fps),
            size: {
              width: overlay.width,
              height: overlay.height,
              sourceWidth: overlay.width,
              sourceHeight: overlay.height,
            },
          });
        }
        const scale = Math.min(out.width / overlay.width, out.height / overlay.height);
        const w = overlay.width * scale,
          h = overlay.height * scale,
          x = (out.width - w) / 2,
          y = (out.height - h) / 2;
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(video, x, y, w, h);
        ctx.drawImage(overlay, x, y, w, h);
      }
      previous = s;
      const image = out.toDataURL('image/jpeg', 0.94);
      if (dir.command) await dir.command('recording.frame', [sessionId, index, image]);
      else await sendExportFrame(sessionId, index, image);
      progress(Math.floor(((index + 1) * 95) / count));
    }
    signal.throwIfAborted();
    const file =
      (name
        .normalize('NFC')
        .replace(/[^\p{L}\p{N} _-]/gu, '')
        .trim()
        .slice(0, 60) || 'Take') +
      '-' +
      id +
      '.mp4';
    if (dir.command) await dir.command('recording.finish', [sessionId, file]);
    else {
      await encodeExport(sessionId, fps);
      signal.throwIfAborted();
      const blob = await downloadExportFile(sessionId);
      signal.throwIfAborted();
      const writer = await (await getFilePath(dir, ['exports', 'recordings', file], true)).createWritable();
      await writer.write(blob);
      await writer.close();
    }
    progress(100);
    return 'exports/recordings/' + file;
  } finally {
    video.removeAttribute('src');
    video.load();
    if (dir.command) await dir.command('recording.cleanup', [sessionId]);
    else await cleanupExport(sessionId);
  }
}
