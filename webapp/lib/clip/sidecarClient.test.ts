import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractErrorMessage,
  requestTracking,
  requestExactMotionEncode,
} from './sidecarClient';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractErrorMessage', () => {
  it('uses string detail when available', () => {
    expect(extractErrorMessage({ detail: 'Video file not found' }, 'fallback')).toBe('Video file not found');
  });

  it('uses nested detail.message when detail is an object', () => {
    expect(extractErrorMessage({ detail: { message: 'Tracking failed' } }, 'fallback')).toBe('Tracking failed');
  });

  it('falls back to message when detail is absent', () => {
    expect(extractErrorMessage({ message: 'Something went wrong' }, 'fallback')).toBe('Something went wrong');
  });

  it('returns fallback when no known error shape exists', () => {
    expect(extractErrorMessage({}, 'fallback')).toBe('fallback');
  });
});

describe('requestExactMotionEncode', () => {
  it('posts to the exact-motion endpoint and returns the encoded blob', async () => {
    const encodedBlob = new Blob(['motion'], { type: 'video/mp4' });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => encodedBlob,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestExactMotionEncode({
      videoRef: 'video-ref-1',
      startMs: 1000,
      endMs: 2000,
    }, 'http://127.0.0.1:8321');

    expect(result).toBe(encodedBlob);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8321/derived-media/exact-motion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoRef: 'video-ref-1',
        startMs: 1000,
        endMs: 2000,
      }),
    });
  });

  it('surfaces the sidecar error message when exact-motion encoding fails', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 501,
      json: async () => ({ detail: 'ffmpeg missing' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      requestExactMotionEncode({
        videoRef: 'video-ref-1',
        startMs: 1000,
        endMs: 2000,
      }, 'http://127.0.0.1:8321'),
    ).rejects.toThrow('ffmpeg missing');
  });
});

describe('requestTracking', () => {
  it('surfaces debug artifact details from nested error payloads', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({
        detail: {
          message: 'Tracking failed',
          detectedBboxes: [{ x: 1, y: 2, w: 3, h: 4, confidence: 0.9 }],
          debugVideoPath: '/tmp/tracking_debug_demo.mp4',
          debugVideoUrl: '/track/debug/tracking_debug_demo.mp4',
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      requestTracking({
        videoRef: 'video-ref-1',
        startMs: 1000,
        endMs: 2000,
        seedBbox: { x: 10, y: 20, w: 30, h: 40 },
        seedFrameMs: 1200,
      }, 'http://127.0.0.1:8321'),
    ).rejects.toMatchObject({
      message: 'Tracking failed',
      detectedBboxes: [{ x: 1, y: 2, w: 3, h: 4, confidence: 0.9 }],
      debugVideoPath: '/tmp/tracking_debug_demo.mp4',
      debugVideoUrl: '/track/debug/tracking_debug_demo.mp4',
    });
  });
});
