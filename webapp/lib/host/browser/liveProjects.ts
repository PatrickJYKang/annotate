const CHANNEL_PREFIX = 'annotate:live-project:';
const RESPONSE_TIMEOUT_MS = 1000;

type HandleRequest = { type: 'request'; requestId: string };
type HandleResponse = { type: 'handle'; requestId: string; handle: FileSystemDirectoryHandle };

function openChannel(scopeId: string): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`${CHANNEL_PREFIX}${scopeId}`);
  } catch {
    return null;
  }
}

function validMessage(event: MessageEvent, type: string): boolean {
  return event.origin === window.location.origin
    && event.data?.type === type
    && typeof event.data.requestId === 'string'
    && /^[a-zA-Z0-9-]{1,100}$/.test(event.data.requestId);
}

/** Share only this open project's existing grant, never request another permission. */
export function shareLiveProject(scopeId: string, handle: FileSystemDirectoryHandle): () => void {
  const channel = openChannel(scopeId);
  if (!channel) return () => undefined;
  let closed = false;
  channel.onmessage = (event: MessageEvent<HandleRequest>) => {
    if (!validMessage(event, 'request')) return;
    void (async () => {
      if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted' || closed) return;
      channel.postMessage({ type: 'handle', requestId: event.data.requestId, handle } satisfies HandleResponse);
    })().catch(() => undefined);
  };
  return () => { closed = true; channel.close(); };
}

export function requestLiveProject(
  scopeId: string,
  expected: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle | null> {
  const channel = openChannel(scopeId);
  if (!channel) return Promise.resolve(null);
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    let finished = false;
    const finish = (handle: FileSystemDirectoryHandle | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      channel.close();
      resolve(handle);
    };
    const timer = setTimeout(() => finish(null), RESPONSE_TIMEOUT_MS);
    channel.onmessage = (event: MessageEvent<HandleResponse>) => {
      if (!validMessage(event, 'handle') || event.data.requestId !== requestId) return;
      void (async () => {
        const handle = event.data.handle;
        if (handle?.kind !== 'directory'
          || !await expected.isSameEntry(handle)
          || await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') return;
        finish(handle);
      })().catch(() => undefined);
    };
    try {
      channel.postMessage({ type: 'request', requestId } satisfies HandleRequest);
    } catch {
      finish(null);
    }
  });
}
