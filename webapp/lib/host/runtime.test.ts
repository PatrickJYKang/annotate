import { afterEach, expect, it, vi } from 'vitest';
import { getSidecarBaseUrl, sidecarAuthorization, sidecarFetch, validateHostRuntime } from './runtime';
import { checkHealth } from '../clip/sidecarClient';

afterEach(() => vi.unstubAllGlobals());

it('uses a startup-selected endpoint without recompiling or caching it at module import', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"status":"ok"}'));
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('window', { __ANNOTATE_RUNTIME__: { version: 1, host: 'desktop', sidecar: { baseUrl: 'http://127.0.0.1:9182', token: 'a'.repeat(64) } } });
  expect(getSidecarBaseUrl()).toBe('http://127.0.0.1:9182');
  await checkHealth();
  expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:9182/health');
  expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBe(`Bearer ${'a'.repeat(64)}`);
});

it('does not send its token to an override endpoint or follow authenticated redirects', async () => {
  vi.stubGlobal('window', { __ANNOTATE_RUNTIME__: { version: 1, host: 'desktop', sidecar: { baseUrl: 'http://127.0.0.1:9182', token: 'a'.repeat(64) } } });
  const fetch = vi.fn().mockResolvedValue(new Response('ok'));
  vi.stubGlobal('fetch', fetch);
  expect(sidecarAuthorization('http://127.0.0.1:9183')).toBeUndefined();
  expect(sidecarAuthorization('https://example.com')).toBeUndefined();
  await sidecarFetch('http://127.0.0.1:9182/track', { headers: { 'Content-Type': 'application/json' } });
  expect(fetch.mock.calls[0][1].redirect).toBe('error');
  expect(new Headers(fetch.mock.calls[0][1].headers).get('Content-Type')).toBe('application/json');
});

it('rejects unsafe desktop runtime settings and retains the legacy browser override', () => {
  for (const baseUrl of ['https://example.com', 'file:///tmp', 'http://user:password@localhost', 'http://localhost/path', 'http://localhost?token=x']) {
    expect(() => validateHostRuntime({ version: 1, host: 'desktop', sidecar: { baseUrl } })).toThrow();
  }
  vi.stubGlobal('window', { __SIDECAR_URL: 'http://127.0.0.1:1234' });
  expect(getSidecarBaseUrl()).toBe('http://127.0.0.1:1234');
});
