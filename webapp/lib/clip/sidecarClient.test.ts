import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractErrorMessage,
  normalizeVideoImportWithMetadata,
  prepareVideoImportWithMetadata,
  probeVideoImport,
  readNormalizedVideoMetadata,
  requestTracking,
  requestExactMotionEncode,
} from './sidecarClient';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('authoritative video metadata', () => {
  it('reads normalize headers without inferring frame count from duration', () => {
    const headers = new Headers({
      'X-Annotate-Frame-Count': '301',
      'X-Annotate-Fps': '30',
    });

    expect(readNormalizedVideoMetadata({ headers }, { width: 1920, height: 1080 })).toEqual({
      fps: 30,
      frameCount: 301,
      width: 1920,
      height: 1080,
      durationMs: 30100 / 3,
      frameCountSource: 'normalize',
    });
  });

  it('fails a frame-native import when authoritative job metadata is absent', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/video/normalize/start')) {
        return new Response(JSON.stringify({ jobId: 'job-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/video/normalize/job-1/file')) {
        return new Response(new Blob(['video']), { status: 200 });
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 200 });
      return new Response(JSON.stringify({
        jobId: 'job-1',
        status: 'complete',
        progress: 1,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(normalizeVideoImportWithMetadata(
      new File(['source'], 'source.mp4', { type: 'video/mp4' }),
      30,
      { width: 1920, height: 1080 },
    )).rejects.toThrow('authoritative media metadata');
  });

  it('reports observable upload, transcode, probe, and download progress', async () => {
    let statusRead = 0;
    const progress: Array<{ phase: string; progress: number }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/video/normalize/start')) {
        return new Response(JSON.stringify({ jobId: 'job-2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/video/normalize/job-2/file')) {
        return new Response(new Blob(['normalized']), {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': '10',
            'X-Annotate-Frame-Count': '300',
            'X-Annotate-Fps': '30',
          },
        });
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 200 });
      statusRead += 1;
      const statuses = [
        { jobId: 'job-2', status: 'normalizing', progress: 0.5 },
        { jobId: 'job-2', status: 'probing', progress: 1 },
        {
          jobId: 'job-2',
          status: 'complete',
          progress: 1,
          metadata: {
            fps: 30,
            frameCount: 300,
            width: 1920,
            height: 1080,
            durationMs: 10000,
            frameCountSource: 'normalize',
            importStrategy: 'transcode',
          },
        },
      ];
      return new Response(JSON.stringify(statuses[Math.min(statusRead - 1, statuses.length - 1)]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const result = await normalizeVideoImportWithMetadata(
      new File(['source'], 'source.mp4', { type: 'video/mp4' }),
      30,
      { width: 1920, height: 1080 },
      { onProgress: (entry) => progress.push(entry) },
    );

    expect(result.metadata.frameCount).toBe(300);
    expect(await result.blob.text()).toBe('normalized');
    expect(progress.map((entry) => entry.phase)).toEqual(expect.arrayContaining([
      'uploading',
      'queued',
      'normalizing',
      'probing',
      'downloading',
      'complete',
    ]));
    expect(progress.at(-1)).toEqual({ phase: 'complete', progress: 1 });
  });

  it('returns probe metadata with an explicit authority source', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      fps: 25,
      frameCount: 250,
      width: 1280,
      height: 720,
      durationMs: 10000,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(probeVideoImport(new File(['source'], 'source.mp4'))).resolves.toEqual({
      fps: 25,
      frameCount: 250,
      width: 1280,
      height: 720,
      durationMs: 10000,
      frameCountSource: 'probe',
    });
  });

  it('reuses the original browser file when the sidecar selects preserve', async () => {
    let statusRead = 0;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/video/normalize/start')) {
        return new Response(JSON.stringify({ jobId: 'preserve-job' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 200 });
      statusRead += 1;
      return new Response(JSON.stringify(statusRead === 1 ? {
        jobId: 'preserve-job', status: 'analyzing', progress: 1,
      } : {
        jobId: 'preserve-job', status: 'complete', progress: 1,
        metadata: {
          fps: 25,
          frameCount: 250,
          width: 1280,
          height: 720,
          durationMs: 10000,
          frameCountSource: 'probe',
          importStrategy: 'preserve',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const source = new File(['original'], 'match.mp4', { type: 'video/mp4' });

    const result = await prepareVideoImportWithMetadata(source);

    expect(result.blob).toBe(source);
    expect(result.metadata).toMatchObject({ fps: 25, importStrategy: 'preserve' });
    expect(calls.some((entry) => entry.includes('/file'))).toBe(false);
    expect(calls.some((entry) => entry.startsWith('DELETE '))).toBe(true);
  });
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
