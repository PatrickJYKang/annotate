export interface HostRuntime {
  version: 1;
  host: 'browser' | 'desktop';
  sidecar: { baseUrl: string; token?: string };
}

declare global {
  interface Window {
    __ANNOTATE_RUNTIME__?: HostRuntime;
    __SIDECAR_URL?: string;
  }
}

export function validateHostRuntime(value: HostRuntime): HostRuntime {
  if (value?.version !== 1 || !['browser', 'desktop'].includes(value.host)) throw new Error('Unsupported host runtime configuration.');
  const url = new URL(value.sidecar?.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid sidecar endpoint.');
  }
  if (value.host === 'desktop' && (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || (url.pathname !== '/' && !/^\/session\/[a-f0-9-]{36}\/?$/.test(url.pathname)))) {
    throw new Error('Desktop sidecar connections must use loopback.');
  }
  if (value.sidecar.token !== undefined && !/^[A-Za-z0-9_-]{32,256}$/.test(value.sidecar.token)) throw new Error('Invalid sidecar session token.');
  if (value.host === 'desktop' && !value.sidecar.token) throw new Error('Desktop sidecar connections require a session token.');
  return { version: 1, host: value.host, sidecar: { baseUrl: `${url.origin}${url.pathname.replace(/\/$/, '')}`, token: value.sidecar.token } };
}

export function getHostRuntime(): HostRuntime {
  if (typeof window !== 'undefined' && window.__ANNOTATE_RUNTIME__) return validateHostRuntime(window.__ANNOTATE_RUNTIME__);
  const baseUrl = (typeof window !== 'undefined' && window.__SIDECAR_URL)
    || process.env.NEXT_PUBLIC_SIDECAR_URL || 'http://127.0.0.1:8321';
  return validateHostRuntime({ version: 1, host: 'browser', sidecar: { baseUrl } });
}

export function getSidecarBaseUrl(): string { return getHostRuntime().sidecar.baseUrl; }

export function sidecarAuthorization(url: string): string | undefined {
  const runtime = getHostRuntime();
  const endpoint = new URL(runtime.sidecar.baseUrl);
  const target = new URL(url);
  const prefix = endpoint.pathname.replace(/\/$/, '');
  return runtime.sidecar.token && target.origin === endpoint.origin && (target.pathname === prefix || target.pathname.startsWith(`${prefix}/`))
    ? `Bearer ${runtime.sidecar.token}` : undefined;
}

export function sidecarFetch(url: string, init?: RequestInit): Promise<Response> {
  const authorization = sidecarAuthorization(url);
  if (!authorization) return fetch(url, init);
  const headers = new Headers(init?.headers);
  headers.set('Authorization', authorization);
  return fetch(url, { ...init, headers, redirect: 'error' });
}
