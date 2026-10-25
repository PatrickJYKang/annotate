import { describe, expect, it } from 'vitest';

import {
  canRunRangeSidecarAction,
  clampFrame,
  encodeDurationMs,
  frameBoundary,
  frameRangeDuration,
  frameToCenterSeconds,
  frameToMs,
  frameToSeconds,
  lastFrameOfRange,
  mediaTimeToVideoFrame,
  presentedTimeToVideoFrame,
  sidecarSampleEndMs,
  timestampMsToNearestFrame,
  videoFrame,
} from './frameMath';

describe('frameMath', () => {
  it.each([25, 30, 50, 60])('round-trips exact displayed frames at %i fps', (fps) => {
    const frameCount = 500;
    for (const index of [0, 1, 47, frameCount - 1]) {
      const frame = videoFrame(index);
      expect(mediaTimeToVideoFrame(frameToSeconds(frame, fps), fps, frameCount)).toBe(index);
      expect(timestampMsToNearestFrame(frameToMs(frame, fps), fps, frameCount)).toBe(index);
    }
  });

  it('uses floor semantics for the playback clock on either side of a frame boundary', () => {
    const fps = 30;
    const boundary = 12 / fps;

    expect(mediaTimeToVideoFrame(boundary - 0.00001, fps, 100)).toBe(11);
    expect(mediaTimeToVideoFrame(boundary, fps, 100)).toBe(12);
    expect(mediaTimeToVideoFrame(boundary + 0.00001, fps, 100)).toBe(12);
  });

  it.each([25, 30000 / 1001, 30, 60000 / 1001, 421059 / 16843])(
    'resolves microsecond-quantized decoded frame timestamps at %f fps',
    (fps) => {
      for (const index of [0, 1, 137, 9437, 9438, 9439, 12538, 12539, 157898]) {
        const time = frameToSeconds(videoFrame(index), fps);
        for (const quantize of [Math.floor, Math.round]) {
          const timestamp = quantize(time * 1e6) / 1e6;
          expect(presentedTimeToVideoFrame(timestamp, fps, 157899)).toBe(index);
        }
      }
    },
  );

  it('distinguishes decoded-frame timestamps from arbitrary playhead times', () => {
    const fps = 421059 / 16843;
    const timestamp = 377.494344; // Decoded frame 9437 in the recorded match.
    expect(mediaTimeToVideoFrame(timestamp, fps, 157899)).toBe(9436);
    expect(presentedTimeToVideoFrame(timestamp, fps, 157899)).toBe(9437);
    expect(presentedTimeToVideoFrame(-1, fps, 157899)).toBe(0);
    expect(presentedTimeToVideoFrame(Number.NaN, fps, 157899)).toBe(0);
    expect(presentedTimeToVideoFrame(1e6, fps, 157899)).toBe(157898);
  });

  it.each([25, 29.97, 30, 59.94, 421059 / 16843])(
    'seeks to a stable point inside the requested frame at %i fps',
    (fps) => {
      for (const index of [0, 137, 9438, 12539, 157898]) {
        const frame = videoFrame(index);
        const seekTime = Math.floor(frameToCenterSeconds(frame, fps) * 1e6) / 1e6;
        expect(mediaTimeToVideoFrame(seekTime, fps, 157899)).toBe(frame);
        expect(seekTime).toBeGreaterThan(frameToSeconds(frame, fps));
        expect(seekTime).toBeLessThan(frameToSeconds(videoFrame(index + 1), fps));
      }
    },
  );

  it('clamps display frames without treating the exclusive end as displayable', () => {
    expect(clampFrame(200, 200)).toBe(199);
    expect(mediaTimeToVideoFrame(100, 30, 200)).toBe(199);
    expect(clampFrame(-20, 200)).toBe(0);
  });

  it('keeps half-open range duration and sidecar inclusive-end math distinct', () => {
    const range = { startFrame: videoFrame(40), endFrame: frameBoundary(70) };

    expect(frameRangeDuration(range)).toBe(30);
    expect(lastFrameOfRange(range)).toBe(69);
    expect(sidecarSampleEndMs(range, 30)).toBeCloseTo(2300, 8);
    expect(encodeDurationMs(range, 30)).toBeCloseTo(1000, 8);
  });

  it('accepts a one-frame clip but refuses it for range-based sidecar actions', () => {
    const range = { startFrame: videoFrame(19), endFrame: frameBoundary(20) };

    expect(frameRangeDuration(range)).toBe(1);
    expect(lastFrameOfRange(range)).toBe(19);
    expect(canRunRangeSidecarAction(range)).toBe(false);
    expect(canRunRangeSidecarAction({ startFrame: videoFrame(19), endFrame: frameBoundary(21) })).toBe(true);
  });

  it.each([30, 5])(
    'keeps the inclusive sidecar sampler inside the source range at %i requested fps',
    (sampleFps) => {
      const videoFps = 30;
      const frameCount = 300;
      const range = { startFrame: videoFrame(31), endFrame: frameBoundary(91) };
      const startMs = Number(frameToMs(range.startFrame, videoFps));
      const endMs = Number(sidecarSampleEndMs(range, videoFps));
      const intervalMs = 1000 / sampleFps;
      const timestamps: number[] = [];

      for (let timestamp = startMs; timestamp <= endMs + 1e-6; timestamp += intervalMs) {
        timestamps.push(timestamp);
      }

      expect(timestamps.length).toBeGreaterThan(0);
      for (const timestamp of timestamps) {
        const frame = timestampMsToNearestFrame(timestamp, videoFps, frameCount);
        expect(frame).toBeGreaterThanOrEqual(range.startFrame);
        expect(frame).toBeLessThan(range.endFrame);
      }
      expect(
        timestamps.every(
          (timestamp) => Number(timestampMsToNearestFrame(timestamp, videoFps, frameCount)) !== Number(range.endFrame),
        ),
      ).toBe(true);
    },
  );

  it('rejects malformed frame brands and ranges at their construction boundary', () => {
    expect(() => videoFrame(-1)).toThrow('non-negative integer');
    expect(() => frameBoundary(1.5)).toThrow('non-negative integer');
    expect(() => lastFrameOfRange({ startFrame: videoFrame(3), endFrame: frameBoundary(3) })).toThrow(
      'greater than startFrame',
    );
  });
});
