import { frameToCenterSeconds, videoFrame } from './frameMath';

type PreviewVideo = Pick<HTMLVideoElement, 'currentTime' | 'seeking' | 'pause' | 'addEventListener' | 'removeEventListener'>;

export function createTrackingFrameFollower(video: PreviewVideo, fps: number, onFrame: (frame: number) => void) {
  const intervalMs = 1000 / 10;
  let pending: number | null = null;
  let seekingFrame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSeekAt = -Infinity;
  let disposed = false;

  const pump = () => {
    if (disposed || pending == null || seekingFrame != null || video.seeking || timer != null) return;
    const delay = intervalMs - (performance.now() - lastSeekAt);
    if (delay > 0) {
      timer = setTimeout(() => { timer = null; pump(); }, Math.ceil(delay));
      return;
    }
    const frame = pending;
    pending = null;
    const time = frameToCenterSeconds(videoFrame(frame), fps);
    if (Math.abs(video.currentTime - time) < 0.1 / fps) {
      onFrame(frame);
      return;
    }
    lastSeekAt = performance.now();
    seekingFrame = frame;
    try {
      video.currentTime = time;
    } catch {
      // A failed preview seek must not abort or delay the tracking stream.
      seekingFrame = null;
    }
  };

  const seeked = () => {
    if (disposed) return;
    const frame = seekingFrame;
    seekingFrame = null;
    // Move the annotation clock only once the matching video frame is decoded.
    // Ignore a seek superseded by a manual timeline action.
    if (frame != null && Math.abs(video.currentTime - frameToCenterSeconds(videoFrame(frame), fps)) < 0.5 / fps) {
      onFrame(frame);
    }
    pump();
  };

  video.pause();
  video.addEventListener('seeked', seeked);
  return {
    follow(frame: number) {
      if (disposed) return;
      // Latest wins: retain every tracked keyframe, but never queue video decodes.
      pending = frame;
      pump();
    },
    dispose() {
      disposed = true;
      pending = null;
      if (timer != null) clearTimeout(timer);
      video.removeEventListener('seeked', seeked);
    },
  };
}
