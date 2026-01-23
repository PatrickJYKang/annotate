export type VideoMeta = {
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
};

export async function extractVideoMetadata(file: File): Promise<VideoMeta> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true as any;
  video.src = url;

  const loaded = await new Promise<void>((resolve, reject) => {
    const onLoaded = () => resolve();
    const onError = () => reject(new Error('Failed to load video metadata'));
    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
  void loaded; // no-op

  const meta: VideoMeta = {
    durationMs: isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined,
    width: (video as any).videoWidth || undefined,
    height: (video as any).videoHeight || undefined,
  };

  // Best-effort FPS using requestVideoFrameCallback (Chromium). Optional.
  const rvfc: any = (video as any).requestVideoFrameCallback;
  if (typeof rvfc === 'function') {
    try {
      await video.play();
      const t0 = await new Promise<number>((resolve) => {
        rvfc.call(video, (_: any, info: any) => resolve(performance.now()));
      });
      const t1 = await new Promise<number>((resolve) => {
        rvfc.call(video, (_: any, info: any) => resolve(performance.now()));
      });
      const dt = t1 - t0;
      if (dt > 0 && dt < 200) {
        meta.fps = +(1000 / dt).toFixed(2);
      }
    } catch {
      // ignore
    } finally {
      try { await video.pause(); } catch {}
    }
  }

  URL.revokeObjectURL(url);
  return meta;
}
