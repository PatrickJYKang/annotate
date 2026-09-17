export interface DirectoryToken { id: string; path: string; name: string }
export interface DesktopBridge {
  request<T>(operation: string, input?: unknown): Promise<T>;
  onChange(listener: (projectId: string) => void): () => void;
  onProgress(listener: (progress: { requestId: string; phase: string; progress: number }) => void): () => void;
  beforeClose(callback: () => Promise<void>): () => void;
}
interface HostReply<T> { ok: boolean; result?: T; error?: { name: string; message: string } }
interface DesktopWireBridge extends Omit<DesktopBridge, 'request'> {
  request<T>(operation: string, input?: unknown): Promise<HostReply<T>>;
}
declare global { interface Window { annotateDesktop?: DesktopWireBridge } }
export function desktopBridge(): DesktopBridge {
  const bridge = typeof window === 'undefined' ? undefined : window.annotateDesktop;
  if (!bridge) throw new Error('Desktop host is unavailable.');
  return {
    ...bridge,
    async request<T>(operation: string, input?: unknown): Promise<T> {
      const reply = await bridge.request<T>(operation, input);
      if (!reply.ok) {
        const name = reply.error?.name ?? 'Error';
        const message = reply.error?.message ?? 'Host operation failed.';
        if (['NotFoundError', 'TypeMismatchError', 'NotAllowedError', 'AbortError', 'InvalidModificationError'].includes(name)) throw new DOMException(message, name);
        const error = new Error(message);
        error.name = name;
        throw error;
      }
      return reply.result as T;
    },
  };
}
