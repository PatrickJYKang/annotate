import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupDerivedMediaJob,
  downloadDerivedMediaJobOutput,
  extractErrorMessage,
  getDerivedMediaJobStatus,
  requestPreviewProxyEncode,
  startPreviewProxyEncodeJob,
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

describe('requestPreviewProxyEncode', () => {
  it('posts to the preview-proxy endpoint and returns the encoded blob', async () => {
    const encodedBlob = new Blob(['proxy'], { type: 'video/mp4' });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => encodedBlob,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestPreviewProxyEncode({ videoRef: 'video-ref-1' }, 'http://127.0.0.1:8321');

    expect(result).toBe(encodedBlob);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8321/derived-media/preview-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoRef: 'video-ref-1' }),
    });
  });

  it('surfaces the sidecar error message when preview-proxy encoding fails', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 501,
      json: async () => ({ detail: 'ffmpeg missing' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      requestPreviewProxyEncode({ videoRef: 'video-ref-1' }, 'http://127.0.0.1:8321'),
    ).rejects.toThrow('ffmpeg missing');
  });

  it('falls back to a text error body when the sidecar does not return JSON', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('invalid json');
      },
      text: async () => 'preview proxy worker crashed',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      requestPreviewProxyEncode({ videoRef: 'video-ref-1' }, 'http://127.0.0.1:8321'),
    ).rejects.toThrow('preview proxy worker crashed');
  });
});

describe('preview-proxy async jobs', () => {
  it('starts a preview-proxy job and returns job metadata', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        jobId: 'job-1',
        kind: 'preview_proxy',
        status: 'running',
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
        label: 'Encoding preview proxy',
        outputAvailable: false,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await startPreviewProxyEncodeJob({ videoRef: 'video-ref-1' }, 'http://127.0.0.1:8321');

    expect(result.jobId).toBe('job-1');
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8321/derived-media/preview-proxy/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoRef: 'video-ref-1' }),
    });
  });

  it('loads async derived-media job status', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        jobId: 'job-1',
        kind: 'preview_proxy',
        status: 'ready',
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:01:00.000Z',
        label: 'Ready',
        outputAvailable: true,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getDerivedMediaJobStatus('job-1', 'http://127.0.0.1:8321');

    expect(result.status).toBe('ready');
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8321/derived-media/jobs/job-1', {
      method: 'GET',
    });
  });

  it('downloads async derived-media job output as a blob', async () => {
    const encodedBlob = new Blob(['proxy'], { type: 'video/mp4' });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => encodedBlob,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadDerivedMediaJobOutput('job-1', 'http://127.0.0.1:8321');

    expect(result).toBe(encodedBlob);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8321/derived-media/jobs/job-1/file', {
      method: 'GET',
    });
  });

  it('best-effort cleans up async derived-media jobs', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal('fetch', fetchMock);

    await cleanupDerivedMediaJob('job-1', 'http://127.0.0.1:8321');

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8321/derived-media/jobs/job-1', {
      method: 'DELETE',
    });
  });
});
