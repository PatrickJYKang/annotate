"use client";

export type MediaTraceLevel = 'info' | 'warn' | 'error';

export type MediaTraceEntry = {
  seq: number;
  ts: string;
  event: string;
  level: MediaTraceLevel;
  blobUrlId?: string | null;
  [key: string]: unknown;
};

declare global {
  interface Window {
    __ANNOTATE_MEDIA_TRACE__?: MediaTraceEntry[];
    __ANNOTATE_MEDIA_TRACE_SEQ__?: number;
  }
}

const MAX_MEDIA_TRACE_ENTRIES = 500;

export function getBlobUrlId(url: string | null | undefined): string | null {
  if (!url || !url.startsWith('blob:')) {
    return null;
  }
  const match = url.match(/([0-9a-fA-F-]{36})(?:$|[/?#])/);
  return match ? match[1] : url;
}

function pushMediaTraceEntry(entry: MediaTraceEntry) {
  if (typeof window === 'undefined') {
    return;
  }
  const next = window.__ANNOTATE_MEDIA_TRACE__ ?? [];
  next.push(entry);
  if (next.length > MAX_MEDIA_TRACE_ENTRIES) {
    next.splice(0, next.length - MAX_MEDIA_TRACE_ENTRIES);
  }
  window.__ANNOTATE_MEDIA_TRACE__ = next;
}

export function clearMediaTrace() {
  if (typeof window === 'undefined') {
    return;
  }
  window.__ANNOTATE_MEDIA_TRACE__ = [];
  window.__ANNOTATE_MEDIA_TRACE_SEQ__ = 0;
}

export function getMediaTraceSnapshot(): MediaTraceEntry[] {
  if (typeof window === 'undefined') {
    return [];
  }
  return [...(window.__ANNOTATE_MEDIA_TRACE__ ?? [])];
}

export function recordMediaTrace(
  event: string,
  details: Record<string, unknown> = {},
  level: MediaTraceLevel = 'info',
) {
  const blobUrlId = typeof details.blobUrlId === 'string'
    ? details.blobUrlId
    : getBlobUrlId(
        (typeof details.blobUrl === 'string' ? details.blobUrl : null)
        ?? (typeof details.currentUrl === 'string' ? details.currentUrl : null)
        ?? (typeof details.currentSrc === 'string' ? details.currentSrc : null),
      );

  const seq = typeof window !== 'undefined'
    ? ((window.__ANNOTATE_MEDIA_TRACE_SEQ__ = (window.__ANNOTATE_MEDIA_TRACE_SEQ__ ?? 0) + 1), window.__ANNOTATE_MEDIA_TRACE_SEQ__)
    : 0;

  const entry: MediaTraceEntry = {
    seq,
    ts: new Date().toISOString(),
    event,
    level,
    ...details,
    blobUrlId,
  };

  pushMediaTraceEntry(entry);

  const logLabel = `[MediaTrace] ${event}`;
  if (level === 'error') {
    console.error(logLabel, entry);
  } else if (level === 'warn') {
    console.warn(logLabel, entry);
  } else {
    console.info(logLabel, entry);
  }
}
