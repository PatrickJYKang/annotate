export function registerCloseGuard(guard: () => Promise<void>): () => void {
  return typeof window !== 'undefined' && window.annotateDesktop
    ? window.annotateDesktop.beforeClose(guard)
    : () => {};
}
