import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractErrorMessage,
  normalizeVideoImportWithMetadata,
  prepareVideoImportWithMetadata,
  probeVideoImport,
  readNormalizedVideoMetadata,
  requestTracking,
  requestTrackingStream,
  requestPlayerDetections,
  requestExactMotionEncode,
  requestHomographyStream,
} from './sidecarClient';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('homography progress stream', () => {
  const params = { videoRef: 'ref', startFrame: 30, endFrame: 60, sourceFps: 30, everyNFrames: 15 };
  it('reads split progress events before the final response and preserves the frame payload', async () => {
    const encoder = new TextEncoder();
    let finish!: () => void;
    const result = { frames: [{ tMs: 1000, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], method: 'pnlcalib' }] };
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('{"type":"progress","phase":"comp'));
      controller.enqueue(encoder.encode('uting","completed":1,"total":5}\n'));
      finish = () => { controller.enqueue(encoder.encode(JSON.stringify({ type: 'result', result }))); controller.close(); };
    } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    const progress = vi.fn();
    const pending = requestHomographyStream(params, progress, 'http://localhost:8321');
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith({ phase: 'computing', completed: 1, total: 5 }));
    finish();
    await expect(pending).resolves.toEqual(result);
  });

  it.each([
    ['{"type":"error","message":"Model failed"}\n', 'Model failed'],
    ['{"type":"progress","phase":"computing","completed":1,"total":5}\n', 'ended before its final result'],
  ])('does not treat a failed or truncated stream as success', async (body, error) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    await expect(requestHomographyStream(params, vi.fn())).rejects.toThrow(error);
  });

  it('passes cancellation to the request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input, init) => {
      return new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError'))));
    });
    vi.stubGlobal('fetch', fetchMock);
    const pending = requestHomographyStream(params, vi.fn(), 'http://localhost:8321', controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe('authoritative video metadata', () => {
  it.each(['cancel', 'pagehide'])('cleans up an import immediately on %s, including while queued', async (action) => {
    const page = new EventTarget();
    vi.stubGlobal('window', page);
    const controller = new AbortController();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/start')) return Response.json({ jobId: 'queued-import' });
      if (init?.method === 'DELETE') return Response.json({ deleted: true });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const pending = prepareVideoImportWithMetadata(new File(['video'], 'source.mp4'), { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    if (action === 'cancel') controller.abort();
    else page.dispatchEvent(new Event('pagehide'));

    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('/queued-import'), {
      method: 'DELETE', keepalive: true,
    });
    await rejected;
    page.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects an already-canceled import without uploading or starting a job', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(prepareVideoImportWithMetadata(new File(['video'], 'source.mp4'), {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports invalid job states instead of looping forever at queued progress', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/start')) return Response.json({ jobId: 'invalid-state' });
      if (init?.method === 'DELETE') return Response.json({ deleted: true });
      return Response.json({ status: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(prepareVideoImportWithMetadata(new File(['video'], 'source.mp4')))
      .rejects.toThrow('unknown status: unexpected');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

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
        { jobId: 'job-2', status: 'queued', progress: 0 },
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
    const page = new EventTarget();
    vi.stubGlobal('window', page);
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
    page.dispatchEvent(new Event('pagehide'));
    expect(calls.filter((entry) => entry.startsWith('DELETE '))).toHaveLength(1);
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

  it('sends stop-on-loss tracking as an opt-in request', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        keyframes: [],
        trackId: 7,
        detectionCount: 10,
        completed: false,
        stoppedAtMs: 1400,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await requestTracking({
      videoRef: 'video-ref-1',
      startMs: 1000,
      endMs: 2000,
      seedBbox: { x: 10, y: 20, w: 30, h: 40 },
      seedFrameMs: 1000,
      stopOnLoss: true,
    }, 'http://127.0.0.1:8321');

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8321/track', expect.objectContaining({
      body: expect.stringContaining('"stopOnLoss":true'),
    }));
  });

  it('delivers streamed keyframes before the final tracking result resolves', async () => {
    const encoder = new TextEncoder();
    let finishStream = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({
          type: 'keyframe',
          keyframe: { tMs: 1000, x: 10, y: 20, w: 30, h: 40, visible: true },
        })}\n`));
        finishStream = () => {
          controller.enqueue(encoder.encode(`${JSON.stringify({
            type: 'result',
            result: {
              keyframes: [{ tMs: 1000, x: 10, y: 20, w: 30, h: 40, visible: true }],
              trackId: 7,
              detectionCount: 1,
              completed: true,
              stoppedAtMs: null,
            },
          })}\n`));
          controller.close();
        };
      },
    });
    const fetchMock = vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const keyframes: Array<{ tMs: number }> = [];
    let resolved = false;

    const resultPromise = requestTrackingStream({
      videoRef: 'video-ref-1',
      startMs: 1000,
      endMs: 2000,
      seedBbox: { x: 10, y: 20, w: 30, h: 40 },
      seedFrameMs: 1000,
      stopOnLoss: true,
    }, (keyframe) => keyframes.push(keyframe)).then((result) => {
      resolved = true;
      return result;
    });

    await vi.waitFor(() => expect(keyframes).toEqual([{ tMs: 1000, x: 10, y: 20, w: 30, h: 40, visible: true }]));
    expect(resolved).toBe(false);
    finishStream();
    await expect(resultPromise).resolves.toMatchObject({ trackId: 7, completed: true });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8321/track/stream', expect.anything());
  });
});

describe('requestPlayerDetections', () => {
  it('requests all player detections at an exact video timestamp', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        frameMs: 1200,
        detections: [{ x: 10, y: 20, w: 30, h: 40, confidence: 0.9 }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestPlayerDetections({
      videoRef: 'video-ref-1',
      frameMs: 1200,
    }, 'http://127.0.0.1:8321')).resolves.toEqual({
      frameMs: 1200,
      detections: [{ x: 10, y: 20, w: 30, h: 40, confidence: 0.9 }],
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8321/track/detect', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ videoRef: 'video-ref-1', frameMs: 1200 }),
    }));
  });
});
